// Pictures a song carries of itself, and the one a launcher shows.

import { sized, u32be } from "./bytes";

/** Largest cover sent to the page, in bytes. */
export const COVER_BYTES = 1024 * 1024;

/** The picture type ID3v2 and FLAC give a front cover. */
const FRONT_COVER = 3;

export type Picture = {
  /** ID3v2's picture type: {@link FRONT_COVER} for the front cover. */
  kind: number;
  /** Empty when the tag does not say. */
  mime: string;
  data: Uint8Array;
};

/**
 * The front cover, else the first picture, as a `data:` URL. Only pictures
 * with a MIME type and at most {@link COVER_BYTES} count.
 */
export const coverOf = (pictures: readonly Picture[]): string | undefined => {
  const shown = pictures.filter(
    ({ data, mime }) => mime !== "" && data.length <= COVER_BYTES,
  );
  const chosen = shown.find(({ kind }) => kind === FRONT_COVER) ?? shown.at(0);
  return chosen === undefined
    ? undefined
    : `data:${chosen.mime};base64,${base64(chosen.data)}`;
};

/**
 * A FLAC `PICTURE` block's body, as FLAC and Vorbis comments carry one, or
 * `undefined` when it is cut short.
 */
export const flacPicture = (bytes: Uint8Array): Picture | undefined => {
  const mime = sized(bytes, 4, u32be);
  const description =
    mime === undefined ? undefined : sized(bytes, mime.end, u32be);
  // Width, height, depth and colors come between.
  const data =
    description === undefined
      ? undefined
      : sized(bytes, description.end + 16, u32be);
  return mime === undefined || data === undefined
    ? undefined
    : {
        data: data.bytes,
        kind: u32be(bytes, 0),
        mime: String.fromCharCode(...mime.bytes),
      };
};

const base64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
