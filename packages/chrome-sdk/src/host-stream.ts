// The host→chrome stream carries two kinds of thing on one socket: newline
// delimited JSON, and — after an `app_frame` header — that frame's pixels as
// raw bytes.
//
// Pixels travel as bytes rather than inside the JSON because base64 is the
// single most expensive thing in the frame path: encoding a 1494x994 frame
// costs ~9ms, escaping it into JSON ~11ms, and `atob`-ing it back ~31ms on the
// renderer's only thread — the one that also handles the keyboard. None of that
// work exists once the pixels are simply bytes.
//
// This means the stream cannot be treated as text: a pixel is as likely to be
// 0x0a as any other value, so a reader scanning for newlines inside a payload
// would cut a frame in half and never resynchronise. The header says how many
// bytes follow, and those bytes are taken by count.

/** A complete JSON message, with its pixels when it is a frame header. */
export type HostItem = {
  text: string;
  /**
   * Explicitly `ArrayBuffer`-backed rather than the wider `ArrayBufferLike`, so
   * a caller can hand `.buffer` straight to `ImageData` — which rejects a
   * `SharedArrayBuffer` — without copying the pixels again.
   */
  pixels?: Uint8Array<ArrayBuffer>;
};

const NEWLINE = 0x0a;

/**
 * A stateful reader over one host connection: feed it each chunk, get back
 * whatever it completed.
 *
 * Pending bytes are kept as the chunks they arrived in. A line is joined out
 * of them when one is complete, which is cheap because a line is short.
 *
 * A frame is not. Its pixels are copied **once**, straight from the chunks
 * they arrived in into the buffer the page will be handed — a megabytes-large
 * frame arrives in a hundred socket chunks, and joining those into one buffer
 * and then copying the frame out of the join is two full copies of it per
 * frame. That buffer is also the one that gets transferred across the world
 * boundary, so it has to be exactly the frame and nothing else.
 */
export const createHostStreamReader = (): ((
  chunk: Uint8Array,
) => readonly HostItem[]) => {
  let pending: Uint8Array[] = [];
  let pendingLength = 0;
  // Set while a header has been read and its pixels are still arriving.
  // `into` is the frame's own buffer, filled as the chunks come.
  let awaiting:
    | { text: string; into: Uint8Array<ArrayBuffer>; filled: number }
    | undefined;

  const take = (count: number): Uint8Array => {
    const joined = join(pending, pendingLength);
    pending = joined.length > count ? [joined.subarray(count)] : [];
    pendingLength = pending[0]?.length ?? 0;
    return joined.subarray(0, count);
  };

  return (chunk: Uint8Array) => {
    pending.push(chunk);
    pendingLength += chunk.length;

    const items: HostItem[] = [];
    let progressing = true;
    while (progressing) {
      if (awaiting === undefined) {
        const line = takeLine();
        if (line === undefined) {
          progressing = false;
        } else if (line.trim().length === 0) {
          // A keepalive newline carries nothing.
        } else {
          const byteCount = pixelByteCount(line);
          if (byteCount === undefined) {
            items.push({ text: line });
          } else {
            awaiting = {
              filled: 0,
              into: new Uint8Array(byteCount),
              text: line,
            };
          }
        }
      } else {
        fill(awaiting);
        if (awaiting.filled === awaiting.into.length) {
          items.push({ pixels: awaiting.into, text: awaiting.text });
          awaiting = undefined;
        } else {
          progressing = false;
        }
      }
    }
    return items;
  };

  /** Move as much of `pending` into the frame as it still has room for. */
  function fill(frame: {
    into: Uint8Array<ArrayBuffer>;
    filled: number;
  }): void {
    let chunk = pending[0];
    while (frame.filled < frame.into.length && chunk !== undefined) {
      const room = frame.into.length - frame.filled;
      if (chunk.length <= room) {
        frame.into.set(chunk, frame.filled);
        frame.filled += chunk.length;
        pendingLength -= chunk.length;
        pending.shift();
      } else {
        // The chunk straddles the end of this frame: take the part that is
        // the frame's and leave the rest where the next message will find it.
        frame.into.set(chunk.subarray(0, room), frame.filled);
        frame.filled += room;
        pendingLength -= room;
        pending[0] = chunk.subarray(room);
      }
      chunk = pending[0];
    }
  }

  function takeLine(): string | undefined {
    const at = indexOfNewline(pending);
    if (at === undefined) {
      return undefined;
    }
    const line = take(at + 1).subarray(0, at);
    return new TextDecoder().decode(line);
  }
};

/** How many pixel bytes follow this header, or `undefined` if it is not one. */
const pixelByteCount = (line: string): number | undefined => {
  // Only the byte count is read here; the message itself is parsed properly
  // (and validated) by `parseHostMessage` once the frame is whole.
  const parsed: unknown = JSON.parse(line);
  const isFrame =
    typeof parsed === "object" &&
    parsed !== null &&
    "type" in parsed &&
    parsed.type === "app_frame";
  if (!isFrame) {
    return undefined;
  }
  const bytes = (parsed as { bytes?: unknown }).bytes;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) {
    throw new Error(`app_frame header without a byte count: ${line}`);
  }
  return bytes;
};

/** Offset of the first newline across the pending chunks. */
const indexOfNewline = (pending: readonly Uint8Array[]): number | undefined => {
  let base = 0;
  for (const chunk of pending) {
    const at = chunk.indexOf(NEWLINE);
    if (at !== -1) {
      return base + at;
    }
    base += chunk.length;
  }
  return undefined;
};

const join = (chunks: readonly Uint8Array[], length: number): Uint8Array => {
  if (chunks.length === 1 && chunks[0] !== undefined) {
    return chunks[0];
  }
  const joined = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
};
