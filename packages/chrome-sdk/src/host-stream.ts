// The host→chrome stream is newline-delimited JSON, one message per line.
//
// It used to carry a second kind of thing: after an `app_frame` header, that
// frame's pixels as raw bytes, taken by count because a pixel is as likely to
// be 0x0a as any other value and a reader scanning for newlines would cut a
// frame in half. That framing went with the copy path — a client's buffer now
// goes to the display compositor directly and no pixels cross this socket at
// all — and with it the byte-counting reader, the straddling-chunk fill, and
// the frame's own destination buffer.
//
// What is left is a line reader. It still keeps pending bytes as the chunks
// they arrived in and joins only when a line is complete, which is cheap
// because a line is short.

/** A complete JSON message. */
export type HostItem = {
  text: string;
};

const NEWLINE = 0x0a;

/**
 * A stateful reader over one host connection: feed it each chunk, get back
 * whatever it completed.
 */
export const createHostStreamReader = (): ((
  chunk: Uint8Array,
) => readonly HostItem[]) => {
  let pending: Uint8Array[] = [];
  let pendingLength = 0;

  const take = (count: number): Uint8Array => {
    const joined = join(pending, pendingLength);
    pending = joined.length > count ? [joined.subarray(count)] : [];
    pendingLength = pending[0]?.length ?? 0;
    return joined.subarray(0, count);
  };

  const takeLine = (): string | undefined => {
    const at = indexOfNewline(pending);
    if (at === undefined) {
      return undefined;
    }
    const line = take(at + 1).subarray(0, at);
    return new TextDecoder().decode(line);
  };

  return (chunk: Uint8Array) => {
    pending.push(chunk);
    pendingLength += chunk.length;

    const items: HostItem[] = [];
    let line = takeLine();
    while (line !== undefined) {
      // A keepalive newline carries nothing.
      if (line.trim().length > 0) {
        items.push({ text: line });
      }
      line = takeLine();
    }
    return items;
  };
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
