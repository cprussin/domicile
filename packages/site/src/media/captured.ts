// Which docs media files exist, read at build time. The files are
// `docs/media/`, captured on crux by `packages/site/scripts/docs-media.sh` and
// served from R2 (`mediaUrl`).

import { mediaUrl } from "./mediaUrl";

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
  url: typeof mediaUrl = mediaUrl,
): Captured => {
  const png = url(`${name}.png`);
  const webm = url(`${name}.webm`);
  const mp4 = url(`${name}.mp4`);
  if (webm !== undefined && mp4 !== undefined) {
    return { kind: "video", mp4, poster: png, webm };
  } else {
    return png === undefined ? { kind: "missing" } : { kind: "picture", png };
  }
};
