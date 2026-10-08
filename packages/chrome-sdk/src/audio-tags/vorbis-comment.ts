// A Vorbis comment: the tags of FLAC, Vorbis and Opus.
// https://xiph.org/vorbis/doc/v-comment.html

import { sized, u32le } from "./bytes";
import type { ParsedTags } from "./parsed-tags";
import { said } from "./parsed-tags";
import type { Picture } from "./picture";
import { flacPicture } from "./picture";

/** Padded base64, as `METADATA_BLOCK_PICTURE` holds a FLAC picture. */
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The tags in a comment, without its packet's framing. */
export const vorbisComment = (bytes: Uint8Array): ParsedTags => {
  const fields = fieldsOf(bytes);
  const first = (name: string) =>
    said(fields.find((field) => field.name === name)?.value);
  return {
    album: first("ALBUM"),
    artist: first("ARTIST"),
    pictures: fields
      .filter(({ name }) => name === "METADATA_BLOCK_PICTURE")
      .map(({ value }) => pictureIn(value))
      .filter((picture) => picture !== undefined),
    title: first("TITLE"),
  };
};

/**
 * Each `NAME=value`, its name upper-cased since names ignore case. Stops at
 * the first field cut short.
 */
const fieldsOf = (bytes: Uint8Array): Field[] => {
  const vendor = sized(bytes, 0, u32le);
  return vendor === undefined || bytes.length < vendor.end + 4
    ? []
    : fieldsFrom(bytes, vendor.end + 4, u32le(bytes, vendor.end));
};

type Field = { name: string; value: string };

const fieldsFrom = (bytes: Uint8Array, start: number, count: number) => {
  const fields: Field[] = [];
  let at = start;
  for (let field = 0; field < count; field++) {
    const read = sized(bytes, at, u32le);
    if (read === undefined) {
      break;
    }
    const text = new TextDecoder().decode(read.bytes);
    const equals = text.indexOf("=");
    if (equals > 0) {
      fields.push({
        name: text.slice(0, equals).toUpperCase(),
        value: text.slice(equals + 1),
      });
    }
    at = read.end;
  }
  return fields;
};

const pictureIn = (value: string): Picture | undefined =>
  BASE64.test(value)
    ? flacPicture(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)))
    : undefined;
