// An MP4 (M4A) file's item list, `moov/udta/meta/ilst`, as iTunes writes it.

import type { Option, Result } from "@cprussin/option-result";
import { None, Ok, Some } from "@cprussin/option-result";

import type { AudioTags } from "../file-preview";
import type { SystemError } from "../system";
import { fourcc, u32be } from "./bytes";
import type { ParsedTags } from "./parsed-tags";
import { audioTagsOf, merged, NOTHING_SAID, said } from "./parsed-tags";
import { COVER_BYTES } from "./picture";
import type { ReadBytes } from "./read-bytes";

/** The boxes from the top of the file to the item list. */
const PATH = ["moov", "udta", "meta", "ilst"];

/** Largest item read: a cover that is sent, and its framing. */
const ITEM_BYTES = COVER_BYTES + 64 * 1024;

/** A `data` box's type for UTF-8 text. */
const UTF8 = 1;

/** A `data` box's types for images. */
const IMAGES: ReadonlyMap<number, string> = new Map([
  [13, "image/jpeg"],
  [14, "image/png"],
  [27, "image/bmp"],
]);

/** Where a box's contents lie. */
type Span = { start: number; end: number };

type Box = Span & { kind: string };

export const mp4Tags = async (
  read: ReadBytes,
): Promise<Result<AudioTags, SystemError>> =>
  (
    await descend(read, { end: Number.POSITIVE_INFINITY, start: 0 }, PATH)
  ).andThenAsync((found) =>
    found.match({
      None: () => Promise.resolve(Ok(audioTagsOf(NOTHING_SAID))),
      Some: async (list) =>
        (await itemsFrom(read, list.start, list, NOTHING_SAID)).map(
          audioTagsOf,
        ),
    }),
  );

/** The contents of the box at `path` under `within`, if there is one. */
const descend = async (
  read: ReadBytes,
  within: Span,
  path: readonly string[],
): Promise<Result<Option<Span>, SystemError>> => {
  const [kind, ...rest] = path;
  return kind === undefined
    ? Ok(Some(within))
    : (await find(read, within.start, within, kind)).andThenAsync((found) =>
        found.match({
          None: () => Promise.resolve(Ok(None<Span>())),
          Some: async (box) =>
            (await childrenOf(read, box)).andThenAsync((children) =>
              descend(read, children, rest),
            ),
        }),
      );
};

/** The first box of `kind` from `at` on, among those `within`. */
const find = async (
  read: ReadBytes,
  at: number,
  within: Span,
  kind: string,
): Promise<Result<Option<Box>, SystemError>> =>
  (await boxAt(read, at, within)).andThenAsync((found) =>
    found.match({
      None: () => Promise.resolve(Ok(None<Box>())),
      Some: (box) =>
        box.kind === kind
          ? Promise.resolve(Ok(Some(box)))
          : find(read, box.end, within, kind),
    }),
  );

/** The box whose header is at `at`, if one is there and ends `within`. */
const boxAt = async (
  read: ReadBytes,
  at: number,
  within: Span,
): Promise<Result<Option<Box>, SystemError>> =>
  at + 8 > within.end
    ? Ok(None())
    : (await read(at, 16)).map((header) => boxOf(at, within, header));

/**
 * The box `header` starts at `at`. A size of 1 is in the 8 bytes after the
 * type, and 0 runs to the end of `within`.
 */
const boxOf = (at: number, within: Span, header: Uint8Array): Option<Box> => {
  const span =
    header.length < 8
      ? undefined
      : spanOf(at, within, header, u32be(header, 0));
  return span === undefined || span.end > within.end
    ? None()
    : Some({ ...span, kind: fourcc(header, 4) });
};

const spanOf = (
  at: number,
  within: Span,
  header: Uint8Array,
  size: number,
): Span | undefined => {
  switch (size) {
    case 0: {
      return { end: within.end, start: at + 8 };
    }
    case 1: {
      const large =
        header.length < 16
          ? 0
          : u32be(header, 8) * 0x1_00_00_00_00 + u32be(header, 12);
      return large < 16 ? undefined : { end: at + large, start: at + 16 };
    }
    default: {
      return size < 8 ? undefined : { end: at + size, start: at + 8 };
    }
  }
};

/**
 * Where a box's children start. iTunes writes `meta` as a full box, with four
 * bytes of version and flags first; QuickTime does not.
 */
const childrenOf = async (
  read: ReadBytes,
  box: Box,
): Promise<Result<Span, SystemError>> =>
  box.kind === "meta"
    ? (await read(box.start, 4)).map((flags) => ({
        end: box.end,
        start:
          flags.length === 4 && flags.every((byte) => byte === 0)
            ? box.start + 4
            : box.start,
      }))
    : Ok({ end: box.end, start: box.start });

/** `parsed`, and what the items from `at` to the end of the list say. */
const itemsFrom = async (
  read: ReadBytes,
  at: number,
  list: Span,
  parsed: ParsedTags,
): Promise<Result<ParsedTags, SystemError>> =>
  (await boxAt(read, at, list)).andThenAsync((found) =>
    found.match({
      None: () => Promise.resolve(Ok(parsed)),
      Some: async (item) =>
        (await itemOf(read, item)).andThenAsync((itemSaid) =>
          itemsFrom(read, item.end, list, merged(parsed, itemSaid)),
        ),
    }),
  );

const itemOf = async (
  read: ReadBytes,
  item: Box,
): Promise<Result<ParsedTags, SystemError>> =>
  item.end - item.start > ITEM_BYTES
    ? Ok(NOTHING_SAID)
    : (await read(item.start, item.end - item.start)).map((bytes) =>
        saidBy(item.kind, dataIn(bytes)),
      );

/** What an item of `kind` holding `data` says. */
const saidBy = (kind: string, data: readonly Data[]): ParsedTags => {
  const text = data.find(({ type }) => type === UTF8);
  const value = said(
    text === undefined ? undefined : new TextDecoder().decode(text.payload),
  );
  switch (kind) {
    case "©nam": {
      return { ...NOTHING_SAID, title: value };
    }
    case "©ART": {
      return { ...NOTHING_SAID, artist: value };
    }
    case "©alb": {
      return { ...NOTHING_SAID, album: value };
    }
    case "covr": {
      return { ...NOTHING_SAID, pictures: data.flatMap(pictureOf) };
    }
    default: {
      return NOTHING_SAID;
    }
  }
};

/** A cover in the list has no picture type; the first is the one shown. */
const pictureOf = ({ payload, type }: Data) => {
  const mime = IMAGES.get(type);
  return mime === undefined ? [] : [{ data: payload, kind: 0, mime }];
};

/** A `data` box's type, without its version, and its value. */
type Data = { type: number; payload: Uint8Array };

/** The `data` boxes in an item. */
const dataIn = (item: Uint8Array): Data[] => {
  const data: Data[] = [];
  let at = 0;
  while (at + 16 <= item.length) {
    const size = u32be(item, at);
    if (size < 16 || at + size > item.length) {
      break;
    }
    if (fourcc(item, at + 4) === "data") {
      data.push({
        payload: item.subarray(at + 16, at + size),
        type: u32be(item, at + 8) & 0xff_ff_ff,
      });
    }
    at += size;
  }
  return data;
};
