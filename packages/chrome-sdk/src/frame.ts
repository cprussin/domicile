// Helpers for turning an AppFrame message into pixels a canvas can draw.

/**
 * Decode a base64 string into raw bytes. The array is explicitly backed by an
 * `ArrayBuffer` (rather than the wider `ArrayBufferLike`) so callers can hand
 * `.buffer` straight to `ImageData`, which rejects `SharedArrayBuffer`.
 */
export const decodeBase64ToBytes = (
  base64: string,
): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
