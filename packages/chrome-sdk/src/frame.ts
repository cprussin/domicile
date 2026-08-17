// Helpers for turning an AppFrame message into pixels a canvas can draw.

/**
 * Decode a base64 string into raw bytes. The array is explicitly backed by an
 * `ArrayBuffer` (rather than the wider `ArrayBufferLike`) so callers can hand
 * `.buffer` straight to `ImageData`, which rejects `SharedArrayBuffer`.
 *
 * The indexed loop is deliberate, against the usual preference for a pipeline:
 * `Uint8Array.from(binary, cb)` calls back per byte, and an app frame is
 * millions of bytes arriving ~30 times a second on the renderer's only thread.
 * Measured on a 1494x994 frame that costs ~350ms against ~30ms here — the
 * difference between a responsive chrome and one that cannot keep up with the
 * keyboard.
 */
export const decodeBase64ToBytes = (
  base64: string,
): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};
