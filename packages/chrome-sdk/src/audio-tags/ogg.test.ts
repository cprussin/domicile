import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";

import { oggTags } from "./ogg";
import type { ReadBytes } from "./read-bytes";

/** Reads from `bytes`, as a file holding them. */
const reading =
  (bytes: Uint8Array): ReadBytes =>
  (offset, length) =>
    Promise.resolve(Ok(bytes.subarray(offset, offset + length)));

const text = (said: string): number[] => [...new TextEncoder().encode(said)];

const littleEndian = (value: number): number[] => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >> 24) & 0xff,
];

const bigEndian = (value: number): number[] => littleEndian(value).toReversed();

const vorbisComment = (comments: string[]): number[] => [
  ...littleEndian(6),
  ...text("vendor"),
  ...littleEndian(comments.length),
  ...comments.flatMap((comment) => [
    ...littleEndian(text(comment).length),
    ...text(comment),
  ]),
];

/** A FLAC picture block's body, base64, as METADATA_BLOCK_PICTURE holds it. */
const pictureComment = (mime: string, data: number[]): string =>
  `METADATA_BLOCK_PICTURE=${btoa(
    String.fromCharCode(
      ...bigEndian(3),
      ...bigEndian(mime.length),
      ...text(mime),
      ...bigEndian(0),
      ...bigEndian(1),
      ...bigEndian(1),
      ...bigEndian(24),
      ...bigEndian(0),
      ...bigEndian(data.length),
      ...data,
    ),
  )}`;

/** A packet's lacing: 255 for each full segment, then the rest. */
const lacing = (length: number): number[] => [
  ...Array(Math.floor(length / 255)).fill(255),
  length % 255,
];

/**
 * A page of stream `serial`, holding `body` laced as `segments`. `continued`
 * marks a page whose first packet started on an earlier page.
 */
const page = (
  serial: number,
  segments: number[],
  body: number[],
  continued = false,
): number[] => [
  ...text("OggS"),
  0,
  continued ? 1 : 0,
  ...Array(8).fill(0),
  ...littleEndian(serial),
  ...littleEndian(0),
  ...littleEndian(0),
  segments.length,
  ...segments,
  ...body,
];

/** A page holding whole packets. */
const pageOf = (serial: number, packets: number[][]): number[] =>
  page(
    serial,
    packets.flatMap((packet) => lacing(packet.length)),
    packets.flat(),
  );

const noTags = {
  album: undefined,
  artist: undefined,
  cover: undefined,
  title: undefined,
};

describe("oggTags", () => {
  it("reads a Vorbis stream's comment, across pages, and its cover", async () => {
    const comments = [
      ...text("\u0003vorbis"),
      ...vorbisComment([
        "TITLE=Song",
        `ARTIST=${"B".repeat(300)}`,
        pictureComment("image/png", [1, 2, 3]),
      ]),
      1,
    ];
    const laced = lacing(comments.length);
    const bytes = new Uint8Array([
      ...pageOf(7, [[...text("\u0001vorbis"), ...Array(23).fill(0)]]),
      // Another stream's page between them.
      ...pageOf(8, [text("other")]),
      ...page(7, laced.slice(0, 1), comments.slice(0, 255)),
      ...page(7, laced.slice(1), comments.slice(255), true),
    ]);

    expect(await oggTags(reading(bytes))).toStrictEqual(
      Ok({
        ...noTags,
        artist: "B".repeat(300),
        cover: "data:image/png;base64,AQID",
        title: "Song",
      }),
    );
  });

  it("reads an Opus stream's tags", async () => {
    const bytes = new Uint8Array([
      ...pageOf(1, [[...text("OpusHead"), ...Array(11).fill(0)]]),
      ...pageOf(1, [[...text("OpusTags"), ...vorbisComment(["album=Record"])]]),
    ]);

    expect(await oggTags(reading(bytes))).toStrictEqual(
      Ok({ ...noTags, album: "Record" }),
    );
  });

  it("stops reading a comment too big to send", async () => {
    // Pages of 255 full segments: one packet that never ends.
    const full = page(1, Array(255).fill(255), Array(255 * 255).fill(0));
    const pages = 40;
    const first = pageOf(1, [[...text("OpusHead"), ...Array(11).fill(0)]]);
    const bytes = new Uint8Array(first.length + full.length * pages);
    bytes.set(first);
    for (let at = 0; at < pages; at++) {
      bytes.set(full, first.length + at * full.length);
    }
    const asked: number[] = [];
    const read = (offset: number, length: number) => {
      asked.push(offset);
      return reading(bytes)(offset, length);
    };

    expect(await oggTags(read)).toStrictEqual(Ok(noTags));
    expect(Math.max(...asked)).toBeLessThan(full.length * pages);
  });

  it("reads no tags from a stream it does not know", async () => {
    const bytes = new Uint8Array([
      ...pageOf(1, [text("Speex   "), text("comments")]),
    ]);

    expect(await oggTags(reading(bytes))).toStrictEqual(Ok(noTags));
  });
});
