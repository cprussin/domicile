// What a container's tags said, before a cover is chosen.

import type { AudioTags } from "../file-preview";
import type { Picture } from "./picture";
import { coverOf } from "./picture";

/** Each text is the first value of its field; `undefined` when unsaid. */
export type ParsedTags = {
  album: string | undefined;
  artist: string | undefined;
  pictures: readonly Picture[];
  title: string | undefined;
};

export const NOTHING_SAID: ParsedTags = {
  album: undefined,
  artist: undefined,
  pictures: [],
  title: undefined,
};

export const audioTagsOf = ({
  album,
  artist,
  pictures,
  title,
}: ParsedTags): AudioTags => ({
  album,
  artist,
  cover: coverOf(pictures),
  title,
});

/** `first`'s texts, filled in from `then`, with both's pictures. */
export const merged = (first: ParsedTags, then: ParsedTags): ParsedTags => ({
  album: first.album ?? then.album,
  artist: first.artist ?? then.artist,
  pictures: [...first.pictures, ...then.pictures],
  title: first.title ?? then.title,
});

/** `text`, or `undefined` for none or an empty one. */
export const said = (text: string | undefined): string | undefined =>
  text === "" ? undefined : text;
