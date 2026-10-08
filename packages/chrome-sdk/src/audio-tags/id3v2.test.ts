import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { SystemErrorKind } from "../system";
import { id3v2Tags } from "./id3v2";
import type { ReadBytes } from "./read-bytes";

/** Reads from `bytes`, as a file holding them. */
const reading =
  (bytes: Uint8Array): ReadBytes =>
  (offset, length) =>
    Promise.resolve(Ok(bytes.subarray(offset, offset + length)));

const text = (said: string): number[] => [...new TextEncoder().encode(said)];

/** `size` as four bytes of seven bits each. */
const synchsafe = (size: number): number[] => [
  (size >> 21) & 0x7f,
  (size >> 14) & 0x7f,
  (size >> 7) & 0x7f,
  size & 0x7f,
];

const bigEndian = (size: number, bytes: number): number[] =>
  Array.from(
    { length: bytes },
    (_, at) => (size >> (8 * (bytes - 1 - at))) & 0xff,
  );

/** One frame, framed as ID3v2.`version` frames it. */
const frame = (version: 2 | 3 | 4, id: string, body: number[]): number[] => {
  switch (version) {
    case 2: {
      return [...text(id), ...bigEndian(body.length, 3), ...body];
    }
    case 3: {
      return [...text(id), ...bigEndian(body.length, 4), 0, 0, ...body];
    }
    case 4: {
      return [...text(id), ...synchsafe(body.length), 0, 0, ...body];
    }
  }
};

/** A tag holding `body`, its frames. */
const tag = (version: 2 | 3 | 4, body: number[], flags = 0): Uint8Array =>
  new Uint8Array([
    ...text("ID3"),
    version,
    0,
    flags,
    ...synchsafe(body.length),
    ...body,
  ]);

/** A UTF-8 text frame's body. */
const utf8 = (said: string): number[] => [3, ...text(said)];

/** An APIC body: `kind` is the picture type, 3 for the front cover. */
const apic = (mime: string, kind: number, data: number[]): number[] => [
  0,
  ...text(mime),
  0,
  kind,
  ...text("a description"),
  0,
  ...data,
];

/** `body` with a 0x00 after each 0xff a sync word or a 0x00 follows. */
const unsynchronized = (body: number[]): number[] =>
  body.flatMap((byte, at) => {
    const next = body[at + 1];
    return byte === 0xff && next !== undefined && (next >= 0xe0 || next === 0)
      ? [byte, 0]
      : [byte];
  });

const noTags = {
  album: undefined,
  artist: undefined,
  cover: undefined,
  title: undefined,
};

describe("id3v2Tags", () => {
  it("reads the title, artist, album and front cover", async () => {
    const bytes = tag(4, [
      ...frame(4, "TIT2", [...utf8("Song"), 0, ...text("Other")]),
      ...frame(4, "TPE1", utf8("Band")),
      ...frame(4, "TALB", utf8("Record")),
      ...frame(4, "APIC", apic("image/jpeg", 0, [9])),
      ...frame(4, "APIC", apic("image/png", 3, [1, 2, 3])),
      // Padding.
      0,
      0,
      0,
      0,
    ]);

    expect(await id3v2Tags(reading(bytes), 0)).toStrictEqual(
      Ok({
        album: "Record",
        artist: "Band",
        cover: "data:image/png;base64,AQID",
        title: "Song",
      }),
    );
  });

  it("reads ID3v2.3's text in each of its encodings", async () => {
    const bytes = tag(3, [
      // UTF-16 with a little-endian byte order mark.
      ...frame(3, "TIT2", [1, 0xff, 0xfe, 0x53, 0, 0xf6, 0]),
      // UTF-16 with a big-endian one.
      ...frame(3, "TPE1", [1, 0xfe, 0xff, 0, 0x42, 0, 0xe9]),
      // ISO-8859-1.
      ...frame(3, "TALB", [0, 0x52, 0xe9, 0]),
    ]);

    expect(await id3v2Tags(reading(bytes), 0)).toStrictEqual(
      Ok({ ...noTags, album: "Ré", artist: "Bé", title: "Sö" }),
    );
  });

  it("reads ID3v2.2's three-letter frames", async () => {
    const bytes = tag(2, [
      ...frame(2, "TT2", utf8("Song")),
      ...frame(2, "PIC", [0, ...text("PNG"), 3, 0, 1, 2, 3]),
    ]);

    expect(await id3v2Tags(reading(bytes), 0)).toStrictEqual(
      Ok({ ...noTags, cover: "data:image/png;base64,AQID", title: "Song" }),
    );
    // Its flag for an extended header in later versions marks a compressed
    // tag, which this does not read.
    expect(
      await id3v2Tags(reading(tag(2, frame(2, "TT2", utf8("Song")), 0x40)), 0),
    ).toStrictEqual(Ok(noTags));
  });

  it("leaves out a cover too big to send or of no stated kind", async () => {
    const bytes = tag(4, [
      ...frame(4, "APIC", apic("image/png", 3, Array(1024 * 1024 + 1).fill(0))),
      ...frame(4, "APIC", apic("", 3, [1, 2, 3])),
    ]);

    expect(await id3v2Tags(reading(bytes), 0)).toStrictEqual(Ok(noTags));
  });

  it("undoes unsynchronization and skips an extended header", async () => {
    const extended = [0, 0, 0, 6, 0, 0, 0, 0, 0, 0];
    const bytes = tag(
      3,
      unsynchronized([
        ...extended,
        ...frame(3, "TIT2", [0, 0x41]),
        ...frame(3, "APIC", apic("image/png", 3, [0xff, 0xe0])),
      ]),
      0x80 | 0x40,
    );

    expect(await id3v2Tags(reading(bytes), 0)).toStrictEqual(
      Ok({ ...noTags, cover: "data:image/png;base64,/+A=", title: "A" }),
    );
  });

  it("reads ID3v2.4's extended header and frame flags", async () => {
    // Its size counts itself; one byte of flags, none set.
    const extended = [0, 0, 0, 6, 1, 0];
    const flagged = (format: number, body: number[]): number[] => [
      ...text("TIT2"),
      ...synchsafe(body.length),
      0,
      format,
      ...body,
    ];
    const bytes = tag(
      4,
      [
        ...extended,
        // Compressed: passed over.
        ...flagged(0x08, utf8("Squeezed")),
        // Unsynchronized, after the data length it is prefixed with.
        ...flagged(0x02 | 0x01, [0, 0, 0, 4, 0, 0x41, 0xff, 0x00, 0x42]),
      ],
      0x40,
    );

    expect(await id3v2Tags(reading(bytes), 0)).toStrictEqual(
      Ok({ ...noTags, title: "AÿB" }),
    );
  });

  it("keeps what it read before a frame that runs past the tag", async () => {
    const bytes = tag(4, [
      ...frame(4, "TIT2", utf8("Song")),
      ...text("TPE1"),
      ...synchsafe(100),
      0,
      0,
      3,
    ]);

    expect(await id3v2Tags(reading(bytes), 0)).toStrictEqual(
      Ok({ ...noTags, title: "Song" }),
    );
  });

  it("says why a read failed", async () => {
    const failed = { kind: SystemErrorKind.PermissionDenied, message: "no" };

    expect(
      await id3v2Tags(() => Promise.resolve(Err(failed)), 0),
    ).toStrictEqual(Err(failed));
  });
});
