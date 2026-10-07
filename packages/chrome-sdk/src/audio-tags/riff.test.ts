import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";
import type { ReadBytes } from "./read-bytes";
import { aiffTags, wavTags } from "./riff";

/** Reads from `bytes`, as a file holding them. */
const reading =
  (bytes: Uint8Array): ReadBytes =>
  (offset, length) =>
    Promise.resolve(Ok(bytes.subarray(offset, offset + length)));

const text = (said: string): number[] => [...new TextEncoder().encode(said)];

const bigEndian = (value: number): number[] => [
  (value >> 24) & 0xff,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];

const littleEndian = (value: number): number[] => bigEndian(value).toReversed();

/** An ID3v2.4 tag holding a title. */
const titled = (title: string): number[] => {
  const frame = [
    ...text("TIT2"),
    0,
    0,
    0,
    title.length + 1,
    0,
    0,
    3,
    ...text(title),
  ];
  return [...text("ID3"), 4, 0, 0, 0, 0, 0, frame.length, ...frame];
};

describe("wavTags", () => {
  it("reads the ID3 chunk after the samples, past an odd one's padding", async () => {
    const bytes = new Uint8Array([
      ...text("RIFF"),
      ...littleEndian(0),
      ...text("WAVE"),
      ...text("fmt "),
      ...littleEndian(16),
      ...Array(16).fill(0),
      ...text("data"),
      ...littleEndian(3),
      1,
      2,
      3,
      0,
      ...text("id3 "),
      ...littleEndian(titled("Song").length),
      ...titled("Song"),
    ]);

    expect(await wavTags(reading(bytes))).toStrictEqual(
      Ok({
        album: undefined,
        artist: undefined,
        cover: undefined,
        title: "Song",
      }),
    );
  });
});

describe("aiffTags", () => {
  it("reads the ID3 chunk", async () => {
    const bytes = new Uint8Array([
      ...text("FORM"),
      ...bigEndian(0),
      ...text("AIFF"),
      ...text("COMM"),
      ...bigEndian(18),
      ...Array(18).fill(0),
      ...text("ID3 "),
      ...bigEndian(titled("Song").length),
      ...titled("Song"),
    ]);

    expect(await aiffTags(reading(bytes))).toStrictEqual(
      Ok({
        album: undefined,
        artist: undefined,
        cover: undefined,
        title: "Song",
      }),
    );
  });
});
