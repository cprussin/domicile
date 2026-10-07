import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";

import { mp4Tags } from "./mp4";
import type { ReadBytes } from "./read-bytes";

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

/** A box of type `kind`: four bytes, `©` written as 0xa9. */
const box = (kind: string, body: number[]): number[] => [
  ...bigEndian(8 + body.length),
  ...Array.from(kind, (letter) => letter.charCodeAt(0)),
  ...body,
];

/** A `data` box: `type` 1 is UTF-8, 13 JPEG and 14 PNG. */
const data = (type: number, body: number[]): number[] =>
  box("data", [...bigEndian(type), ...bigEndian(0), ...body]);

const noTags = {
  album: undefined,
  artist: undefined,
  cover: undefined,
  title: undefined,
};

describe("mp4Tags", () => {
  it("reads the item list after the media", async () => {
    const items = box("ilst", [
      ...box("©nam", data(1, text("Song"))),
      ...box("©ART", data(1, text("Band"))),
      ...box("©alb", data(1, text("Record"))),
      ...box("covr", [...data(14, [1, 2, 3]), ...data(13, [9])]),
    ]);
    const bytes = new Uint8Array([
      ...box("ftyp", text("M4A mp42")),
      ...box("mdat", Array(100).fill(0)),
      ...box("moov", [
        ...box("mvhd", Array(100).fill(0)),
        ...box("udta", box("meta", [0, 0, 0, 0, ...box("hdlr", []), ...items])),
      ]),
    ]);

    expect(await mp4Tags(reading(bytes))).toStrictEqual(
      Ok({
        album: "Record",
        artist: "Band",
        cover: "data:image/png;base64,AQID",
        title: "Song",
      }),
    );
  });

  it("reads a box's size in each of its forms, and QuickTime's meta", async () => {
    const media = Array(20).fill(0);
    const bytes = new Uint8Array([
      ...box("ftyp", text("M4A mp42")),
      // Size 1: the size is in the eight bytes after the type.
      ...bigEndian(1),
      ...text("mdat"),
      ...bigEndian(0),
      ...bigEndian(16 + media.length),
      ...media,
      // Size 0: to the end of the file.
      ...bigEndian(0),
      ...text("moov"),
      ...box(
        "udta",
        box("meta", [
          ...box("hdlr", []),
          ...box("ilst", [
            ...box("covr", [...data(21, [7]), ...data(14, [1, 2, 3])]),
          ]),
        ]),
      ),
    ]);

    expect(await mp4Tags(reading(bytes))).toStrictEqual(
      Ok({ ...noTags, cover: "data:image/png;base64,AQID" }),
    );
  });

  it("passes over an item too big to send", async () => {
    const cover = box("covr", data(14, Array(1024 * 1024 + 64 * 1024).fill(0)));
    const bytes = new Uint8Array([
      ...box(
        "moov",
        box(
          "udta",
          box("meta", [
            0,
            0,
            0,
            0,
            ...box("ilst", [...cover, ...box("©nam", data(1, text("Song")))]),
          ]),
        ),
      ),
    ]);

    expect(await mp4Tags(reading(bytes))).toStrictEqual(
      Ok({ ...noTags, title: "Song" }),
    );
  });

  it("reads no tags from a file with no item list", async () => {
    const bytes = new Uint8Array([
      ...box("ftyp", text("M4A mp42")),
      ...box("moov", box("mvhd", [])),
    ]);

    expect(await mp4Tags(reading(bytes))).toStrictEqual(Ok(noTags));
  });
});
