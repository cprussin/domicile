// Where a docs media file is served: R2, under the key
// `.github/scripts/docs-media-upload.sh` puts it at. Read at build time.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ORIGIN = "https://media.domicile-desktop.com";
const MEDIA = join(process.cwd(), "..", "..", "docs", "media");

/**
 * The URL of `file` in `docs/media/`, or `undefined` until it is captured.
 * The key starts with the file's hash, so a retake gets a new URL and a
 * deployed site keeps the files it was built with.
 */
export const mediaUrl = (file: string, dir = MEDIA): string | undefined => {
  const path = join(dir, file);
  return existsSync(path) ? `${ORIGIN}/${hash(path)}/${file}` : undefined;
};

const hash = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
