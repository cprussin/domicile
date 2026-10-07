// The ID3v2 chunk of a WAV (RIFF, little-endian sizes) or AIFF (IFF,
// big-endian) file.

import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";

import type { AudioTags } from "../file-preview";
import type { SystemError } from "../system";
import { fourcc, u32be, u32le } from "./bytes";
import { id3v2Tags } from "./id3v2";
import { audioTagsOf, NOTHING_SAID } from "./parsed-tags";
import type { ReadBytes } from "./read-bytes";

/** After the file's own header: its id, size and form type. */
const FIRST_CHUNK = 12;

/** The names writers give the chunk. */
const ID3_CHUNKS = ["id3 ", "ID3 "];

export const wavTags = (
  read: ReadBytes,
): Promise<Result<AudioTags, SystemError>> =>
  id3ChunkFrom(read, FIRST_CHUNK, u32le);

export const aiffTags = (
  read: ReadBytes,
): Promise<Result<AudioTags, SystemError>> =>
  id3ChunkFrom(read, FIRST_CHUNK, u32be);

/** The tags of the first ID3 chunk from `at`, or none. */
const id3ChunkFrom = async (
  read: ReadBytes,
  at: number,
  size: Size,
): Promise<Result<AudioTags, SystemError>> =>
  (await read(at, 8)).andThenAsync((header) =>
    header.length < 8
      ? Promise.resolve(Ok(audioTagsOf(NOTHING_SAID)))
      : chunkAt(read, at, header, size),
  );

type Size = (bytes: Uint8Array, at: number) => number;

/** The chunk whose header is at `at`, if it is ID3, else the ones after. */
const chunkAt = (
  read: ReadBytes,
  at: number,
  header: Uint8Array,
  size: Size,
): Promise<Result<AudioTags, SystemError>> => {
  const bytes = size(header, 4);
  // Chunks are padded to an even size.
  return ID3_CHUNKS.includes(fourcc(header, 0))
    ? id3v2Tags(read, at + 8)
    : id3ChunkFrom(read, at + 8 + bytes + (bytes % 2), size);
};
