// A FLAC file's metadata blocks. https://xiph.org/flac/format.html

import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";

import type { AudioTags } from "../file-preview";
import type { SystemError } from "../system";
import { u24be } from "./bytes";
import type { ParsedTags } from "./parsed-tags";
import { audioTagsOf, merged, NOTHING_SAID } from "./parsed-tags";
import { COVER_BYTES, flacPicture } from "./picture";
import type { ReadBytes } from "./read-bytes";
import { vorbisComment } from "./vorbis-comment";

/** After `fLaC`. */
const FIRST_BLOCK = 4;

const VORBIS_COMMENT = 4;
const PICTURE = 6;

/** Largest picture block read: a cover that is sent, and its description. */
const PICTURE_BLOCK_BYTES = COVER_BYTES + 64 * 1024;

export const flacTags = async (
  read: ReadBytes,
): Promise<Result<AudioTags, SystemError>> =>
  (await blocksFrom(read, FIRST_BLOCK, NOTHING_SAID)).map(audioTagsOf);

/** `parsed`, and what the blocks from `at` to the last say. */
const blocksFrom = async (
  read: ReadBytes,
  at: number,
  parsed: ParsedTags,
): Promise<Result<ParsedTags, SystemError>> =>
  (await read(at, 4)).andThenAsync(async (header) => {
    const [flags] = header;
    return flags === undefined || header.length < 4
      ? Ok(parsed)
      : (await blockAt(read, at, flags & 0x7f, u24be(header, 1))).andThenAsync(
          (said) => {
            const more = merged(parsed, said);
            return (flags & 0x80) === 0
              ? blocksFrom(read, at + 4 + u24be(header, 1), more)
              : Promise.resolve(Ok(more));
          },
        );
  });

/** What the block of `kind` whose header is at `at` says. */
const blockAt = async (
  read: ReadBytes,
  at: number,
  kind: number,
  size: number,
): Promise<Result<ParsedTags, SystemError>> => {
  switch (kind) {
    case VORBIS_COMMENT: {
      return (await read(at + 4, size)).map(vorbisComment);
    }
    case PICTURE: {
      return size > PICTURE_BLOCK_BYTES
        ? Ok(NOTHING_SAID)
        : (await read(at + 4, size)).map(picturedIn);
    }
    default: {
      return Ok(NOTHING_SAID);
    }
  }
};

const picturedIn = (bytes: Uint8Array): ParsedTags => {
  const picture = flacPicture(bytes);
  return picture === undefined
    ? NOTHING_SAID
    : { ...NOTHING_SAID, pictures: [picture] };
};
