// An ID3v2 tag: MP3's, and a chunk of WAV's and AIFF's.
// https://id3.org/id3v2.4.0-structure, id3v2.3.0 and id3v2-00 (2.2).

import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";

import type { AudioTags } from "../file-preview";
import type { SystemError } from "../system";
import { holds, synchsafe, u24be, u32be } from "./bytes";
import type { ParsedTags } from "./parsed-tags";
import { audioTagsOf, NOTHING_SAID, said } from "./parsed-tags";
import type { Picture } from "./picture";
import type { ReadBytes } from "./read-bytes";

const HEADER_BYTES = 10;

/** Header flags. */
const UNSYNCHRONIZED = 0x80;
/** An extended header in 2.3 and 2.4; a compressed tag in 2.2. */
const EXTENDED = 0x40;

/** Frame format flags: 2.3's second byte. Compressed, encrypted, grouped. */
const V3_SKIPPED = 0x80 | 0x40 | 0x20;
/** And 2.4's. Grouped, compressed, encrypted. */
const V4_SKIPPED = 0x40 | 0x08 | 0x04;
const V4_UNSYNCHRONIZED = 0x02;
const V4_LENGTH_INDICATED = 0x01;

/** Frames read, by version: 2.2 names them in three letters. */
const TITLE = ["TT2", "TIT2"];
const ARTIST = ["TP1", "TPE1"];
const ALBUM = ["TAL", "TALB"];

type Header = { version: 2 | 3 | 4; flags: number; size: number };

type Frame = { id: string; body: Uint8Array };

/** Whether `head` starts with an ID3v2 header this reads. */
export const isId3v2 = (head: Uint8Array): boolean =>
  headerOf(head) !== undefined;

/** The tags of the ID3v2 tag at `at`, or none when there is no tag there. */
export const id3v2Tags = async (
  read: ReadBytes,
  at: number,
): Promise<Result<AudioTags, SystemError>> =>
  (await read(at, HEADER_BYTES)).andThenAsync(async (bytes) => {
    const header = headerOf(bytes);
    return header === undefined
      ? Ok(audioTagsOf(NOTHING_SAID))
      : (await read(at + HEADER_BYTES, header.size)).map((body) =>
          audioTagsOf(tagsIn(framesOf(header, body))),
        );
  });

/** The header `bytes` start with, if they hold one of versions 2 to 4. */
const headerOf = (bytes: Uint8Array): Header | undefined => {
  const [version, flags] = [bytes[3], bytes[5]];
  return bytes.length >= HEADER_BYTES &&
    holds(bytes, "ID3") &&
    (version === 2 || version === 3 || version === 4) &&
    flags !== undefined &&
    bytes.subarray(6, 10).every((byte) => byte < 0x80)
    ? { flags, size: synchsafe(bytes, 6), version }
    : undefined;
};

const tagsIn = (frames: readonly Frame[]): ParsedTags => {
  const text = (ids: readonly string[]) => {
    const frame = frames.find(({ id }) => ids.includes(id));
    return frame === undefined
      ? undefined
      : said(decoded(frame.body[0], frame.body.subarray(1)).split("\0")[0]);
  };
  return {
    album: text(ALBUM),
    artist: text(ARTIST),
    pictures: frames.map(pictureIn).filter((picture) => picture !== undefined),
    title: text(TITLE),
  };
};

/** The frames of a tag, up to its padding or a frame cut short. */
const framesOf = ({ flags, version }: Header, tag: Uint8Array): Frame[] => {
  const body =
    (flags & UNSYNCHRONIZED) !== 0 && version < 4 ? resynchronized(tag) : tag;
  const idBytes = version === 2 ? 3 : 4;
  const headerBytes = version === 2 ? 6 : 10;
  const frames: Frame[] = [];
  let at = (flags & EXTENDED) === 0 ? 0 : extendedBytes(version, body);
  while (at + headerBytes <= body.length && body[at] !== 0) {
    const end = at + headerBytes + frameBytes(version, body, at);
    if (end > body.length) {
      break;
    }
    const frame = framed(
      version,
      body.subarray(at, at + headerBytes),
      body.subarray(at + headerBytes, end),
    );
    if (frame !== undefined) {
      frames.push({
        body: frame,
        id: String.fromCharCode(...body.subarray(at, at + idBytes)),
      });
    }
    at = end;
  }
  return frames;
};

/** The size of the frame whose header is at `at`, after its header. */
const frameBytes = (version: 2 | 3 | 4, body: Uint8Array, at: number) => {
  switch (version) {
    case 2: {
      return u24be(body, at + 3);
    }
    case 3: {
      return u32be(body, at + 4);
    }
    case 4: {
      return synchsafe(body, at + 4);
    }
  }
};

/**
 * Where the frames start after an extended header. 2.2's flag means a
 * compressed tag instead, which this does not read: past its end.
 */
const extendedBytes = (version: 2 | 3 | 4, body: Uint8Array): number => {
  switch (version) {
    case 2: {
      return body.length;
    }
    case 3: {
      return body.length < 4 ? body.length : 4 + u32be(body, 0);
    }
    case 4: {
      return body.length < 4 ? body.length : synchsafe(body, 0);
    }
  }
};

/**
 * A frame's data, by its header's format flags, or `undefined` for one this
 * does not read. 2.2 has no flags.
 */
const framed = (
  version: 2 | 3 | 4,
  header: Uint8Array,
  data: Uint8Array,
): Uint8Array | undefined => {
  const format = header[9];
  switch (version) {
    case 2: {
      return data;
    }
    case 3: {
      return format === undefined || (format & V3_SKIPPED) !== 0
        ? undefined
        : data;
    }
    case 4: {
      return format === undefined || (format & V4_SKIPPED) !== 0
        ? undefined
        : v4Data(format, data);
    }
  }
};

const v4Data = (format: number, data: Uint8Array): Uint8Array => {
  const unprefixed = data.subarray(
    (format & V4_LENGTH_INDICATED) === 0 ? 0 : 4,
  );
  return (format & V4_UNSYNCHRONIZED) === 0
    ? unprefixed
    : resynchronized(unprefixed);
};

/** `bytes` without the 0x00 written after each 0xff. */
const resynchronized = (bytes: Uint8Array): Uint8Array =>
  bytes.filter((byte, at) => !(byte === 0 && bytes[at - 1] === 0xff));

/** An `APIC` (2.3, 2.4) or `PIC` (2.2) frame's picture. */
const pictureIn = ({ body, id }: Frame): Picture | undefined => {
  switch (id) {
    case "APIC": {
      const mimeEnd = body.indexOf(0, 1);
      return mimeEnd < 0
        ? undefined
        : described(
            body,
            String.fromCharCode(...body.subarray(1, mimeEnd)),
            mimeEnd + 1,
          );
    }
    case "PIC": {
      const format = String.fromCharCode(...body.subarray(1, 4));
      return described(body, mimeOfFormat(format), 4);
    }
    default: {
      return undefined;
    }
  }
};

/** The picture whose type is at `at`, after which come its description and data. */
const described = (
  body: Uint8Array,
  mime: string,
  at: number,
): Picture | undefined => {
  const kind = body[at];
  const dataAt = afterText(body[0], body, at + 1);
  return kind === undefined || dataAt === undefined
    ? undefined
    : { data: body.subarray(dataAt), kind, mime };
};

/** 2.2 names an image format, not a MIME type. */
const mimeOfFormat = (format: string): string =>
  format === "JPG" ? "image/jpeg" : `image/${format.toLowerCase()}`;

/**
 * Where a terminated string in `encoding` that starts at `at` ends: after
 * one 0x00, or two on an even boundary for UTF-16.
 */
const afterText = (
  encoding: number | undefined,
  body: Uint8Array,
  at: number,
): number | undefined => {
  const wide = encoding === 1 || encoding === 2;
  const end = wide
    ? Array.from(
        { length: Math.max(0, Math.floor((body.length - at) / 2)) },
        (_, pair) => at + 2 * pair,
      ).find((pair) => body[pair] === 0 && body[pair + 1] === 0)
    : body.indexOf(0, at);
  return end === undefined || end < 0 ? undefined : end + (wide ? 2 : 1);
};

/** Text in one of ID3v2's four encodings. */
const decoded = (encoding: number | undefined, bytes: Uint8Array): string => {
  switch (encoding) {
    case 0: {
      return new TextDecoder("latin1").decode(bytes);
    }
    case 1: {
      // UTF-16 says its byte order with a mark; little-endian without one.
      return new TextDecoder(
        bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-16le",
      ).decode(bytes);
    }
    case 2: {
      return new TextDecoder("utf-16be").decode(bytes);
    }
    default: {
      return new TextDecoder().decode(bytes);
    }
  }
};
