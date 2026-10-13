// The settings host's framing on stdin and stdout: each message is a 4-byte
// little-endian length, then that many bytes of UTF-8 JSON. The host's side
// is `domicile_launch::settings`.

/** The bytes of the length before each message. */
const LENGTH_BYTES = 4;

/** `message` as one frame. */
export const encodeFrame = (message: unknown): Uint8Array => {
  const body = new TextEncoder().encode(JSON.stringify(message));
  const frame = new Uint8Array(LENGTH_BYTES + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, true);
  frame.set(body, LENGTH_BYTES);
  return frame;
};

/**
 * A decoder for a stream of frames that arrive in chunks of any size. Each
 * call takes the next chunk and returns the messages it completed, parsed
 * from JSON.
 */
export const frameDecoder = () => {
  let buffered: Uint8Array = new Uint8Array();
  return (chunk: Uint8Array): unknown[] => {
    buffered = joined(buffered, chunk);
    const messages: unknown[] = [];
    for (
      let length = lengthOf(buffered);
      length !== undefined && buffered.length >= LENGTH_BYTES + length;
      length = lengthOf(buffered)
    ) {
      const body = buffered.subarray(LENGTH_BYTES, LENGTH_BYTES + length);
      messages.push(JSON.parse(new TextDecoder().decode(body)));
      buffered = buffered.slice(LENGTH_BYTES + length);
    }
    return messages;
  };
};

/** The length `buffered` starts with, or `undefined` before all of it came. */
const lengthOf = (buffered: Uint8Array): number | undefined =>
  buffered.length < LENGTH_BYTES
    ? undefined
    : new DataView(
        buffered.buffer,
        buffered.byteOffset,
        LENGTH_BYTES,
      ).getUint32(0, true);

const joined = (first: Uint8Array, second: Uint8Array): Uint8Array => {
  const both = new Uint8Array(first.length + second.length);
  both.set(first);
  both.set(second, first.length);
  return both;
};
