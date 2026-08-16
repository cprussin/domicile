// Helpers for turning an AppFrame message into pixels a canvas can draw.

/** Decode a base64 string into a Uint8Array of raw bytes. */
export function decodeBase64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
