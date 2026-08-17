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
 * Pending bytes are kept as the chunks they arrived in and joined only when
 * something is complete, so a frame delivered in hundreds of pieces costs one
 * copy rather than one per piece.
 */
export const createHostStreamReader = (): ((
  chunk: Uint8Array,
) => readonly HostItem[]) => {
  let pending: Uint8Array[] = [];
  let pendingLength = 0;
  // Set while a header has been read and its pixels are still arriving.
  let awaiting: { text: string; byteCount: number } | undefined;

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
            awaiting = { byteCount, text: line };
          }
        }
      } else if (pendingLength < awaiting.byteCount) {
        progressing = false;
      } else {
        // `take` hands back a view over the joined buffer, and the next join
        // would leave that view aliasing memory the reader still owns.
        items.push({
          pixels: new Uint8Array(take(awaiting.byteCount)),
          text: awaiting.text,
        });
        awaiting = undefined;
      }
    }
    return items;
  };

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
