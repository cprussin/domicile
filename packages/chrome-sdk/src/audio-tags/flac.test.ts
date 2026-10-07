import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";

import { flacTags } from "./flac";
import type { ReadBytes } from "./read-bytes";

/** Reads from `bytes`, as a file holding them. */
const reading =
  (bytes: Uint8Array): ReadBytes =>
  (offset, length) =>
    Promise.resolve(Ok(bytes.subarray(offset, offset + length)));

const text = (said: string): number[] => [...new TextEncoder().encode(said)];

const bigEndian = (value: number, bytes: number): number[] =>
  Array.from(
    { length: bytes },
    (_, at) => (value >> (8 * (bytes - 1 - at))) & 0xff,
  );

const littleEndian = (value: number): number[] =>
  bigEndian(value, 4).toReversed();

/** A Vorbis comment holding `comments`, each `NAME=value`. */
const vorbisComment = (comments: string[]): number[] => [
  ...littleEndian(6),
  ...text("vendor"),
  ...littleEndian(comments.length),
  ...comments.flatMap((comment) => [
    ...littleEndian(text(comment).length),
    ...text(comment),
  ]),
];

/** A FLAC picture block's body: `kind` is the picture type. */
const picture = (mime: string, kind: number, data: number[]): number[] => [
  ...bigEndian(kind, 4),
  ...bigEndian(mime.length, 4),
  ...text(mime),
  ...bigEndian(0, 4),
  ...bigEndian(1, 4),
  ...bigEndian(1, 4),
  ...bigEndian(24, 4),
  ...bigEndian(0, 4),
  ...bigEndian(data.length, 4),
  ...data,
];

/** A metadata block of type `kind`, the last if `last`. */
const block = (kind: number, body: number[], last = false): number[] => [
  (last ? 0x80 : 0) | kind,
  ...bigEndian(body.length, 3),
  ...body,
];

describe("flacTags", () => {
  it("reads the Vorbis comment and the front cover", async () => {
    const bytes = new Uint8Array([
      ...text("fLaC"),
      ...block(0, Array(34).fill(0)),
      ...block(6, picture("image/jpeg", 0, [9])),
      ...block(
        4,
        vorbisComment(["title=Song", "ARTIST=Band", "Album=Record", "x"]),
      ),
      ...block(6, picture("image/png", 3, [1, 2, 3]), true),
      // Audio frames, never read.
      0xff,
      0xf8,
    ]);

    expect(await flacTags(reading(bytes))).toStrictEqual(
      Ok({
        album: "Record",
        artist: "Band",
        cover: "data:image/png;base64,AQID",
        title: "Song",
      }),
    );
  });

  it("passes over a picture block too big to send", async () => {
    // It is not the last block, so the walk goes on past it to the end of
    // the file.
    const bytes = new Uint8Array([
      ...text("fLaC"),
      ...block(0, Array(34).fill(0)),
      6,
      ...bigEndian(2 * 1024 * 1024, 3),
    ]);

    expect(await flacTags(reading(bytes))).toStrictEqual(
      Ok({
        album: undefined,
        artist: undefined,
        cover: undefined,
        title: undefined,
      }),
    );
  });
});
