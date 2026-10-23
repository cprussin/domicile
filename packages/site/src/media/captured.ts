// Which docs media files exist, read at build time. The files are
// `docs/media/`, captured on crux by `scripts/docs-media.sh` and served from
// `public/media`.

import { existsSync } from "node:fs";
import { join } from "node:path";

const MEDIA = join(process.cwd(), "public", "media");

/** What a slot shows: a captured video, a captured picture, or neither yet. */
export type Captured =
  | { kind: "video"; webm: string; mp4: string; poster: string | undefined }
  | { kind: "picture"; png: string }
  | { kind: "missing" };

/**
 * The capture named `name`: a video if its webm and mp4 exist (with its png
 * as the poster), else its png, else missing.
 */
export const captured = (
  name: string,
  exists: (file: string) => boolean = (file) => existsSync(join(MEDIA, file)),
): Captured => {
  const png = exists(`${name}.png`) ? `/media/${name}.png` : undefined;
  if (exists(`${name}.webm`) && exists(`${name}.mp4`)) {
    return {
      kind: "video",
      mp4: `/media/${name}.mp4`,
      poster: png,
      webm: `/media/${name}.webm`,
    };
  }
  return png === undefined ? { kind: "missing" } : { kind: "picture", png };
};
