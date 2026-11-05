// Where a docs media file is served: R2, under the key
// `.github/scripts/docs-media-upload.sh` puts it at. Read at build time.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ORIGIN = "https://media.domicile-desktop.com";

/**
 * The URL of `file` in `docs/media/`, or `undefined` until it is captured.
 * The key starts with the file's hash, so a retake gets a new URL and a
 * deployed site keeps the files it was built with.
 */
export const mediaUrl = (
  file: string,
  read: typeof readCaptured = readCaptured,
): string | undefined => {
  const bytes = read(file);
  return bytes === undefined ? undefined : `${ORIGIN}/${hash(bytes)}/${file}`;
};

/** Reads a capture from the repository's media folder. */
const readCaptured = (file: string): Uint8Array | undefined => {
  const path = join(process.cwd(), "..", "..", "docs", "media", file);
  return existsSync(path) ? readFileSync(path) : undefined;
};

const hash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);
