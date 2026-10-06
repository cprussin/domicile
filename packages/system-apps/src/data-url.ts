// Bytes as a `data:` URL, so a page can draw a file it cannot fetch.

/** Bytes passed to `String.fromCharCode` at once, under its argument limit. */
const CHUNK = 0x80_00;

export const dataUrl = (mime: string, bytes: Uint8Array): string => {
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + CHUNK)));
  }
  return `data:${mime};base64,${btoa(chunks.join(""))}`;
};
