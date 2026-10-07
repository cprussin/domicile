// Numbers and names at a place in a file's bytes. The caller checks the bytes
// are there.

export const u32be = (bytes: Uint8Array, at: number): number =>
  view(bytes).getUint32(at);

export const u32le = (bytes: Uint8Array, at: number): number =>
  view(bytes).getUint32(at, true);

export const u24be = (bytes: Uint8Array, at: number): number =>
  view(bytes).getUint16(at) * 0x1_00 + view(bytes).getUint8(at + 2);

/** Four bytes of seven bits each, most significant first, as ID3v2 sizes. */
export const synchsafe = (bytes: Uint8Array, at: number): number =>
  Array.from(bytes.subarray(at, at + 4)).reduce(
    (size, byte) => size * 0x80 + (byte & 0x7f),
    0,
  );

/**
 * The bytes after a four-byte length at `at`, read by `length`, and where
 * they end. `undefined` when `bytes` stop first.
 */
export const sized = (
  bytes: Uint8Array,
  at: number,
  length: (bytes: Uint8Array, at: number) => number,
): { bytes: Uint8Array; end: number } | undefined => {
  const end = bytes.length < at + 4 ? undefined : at + 4 + length(bytes, at);
  return end === undefined || bytes.length < end
    ? undefined
    : { bytes: bytes.subarray(at + 4, end), end };
};

/** Four bytes as ID3, RIFF and MP4 name things: one character each. */
export const fourcc = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + 4));

/** Whether `bytes` hold `text`, one byte a character, at `at`. */
export const holds = (bytes: Uint8Array, text: string, at = 0): boolean =>
  String.fromCharCode(...bytes.subarray(at, at + text.length)) === text;

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
