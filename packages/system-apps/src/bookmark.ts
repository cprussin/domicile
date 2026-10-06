// Web pages a launcher offers by name, beside the applications.

import { z } from "zod";

import { ranked } from "./ranked";

/**
 * A launcher row that opens `url`. Only `http` and `https`: the launcher opens
 * it as a page and fetches the site's icon from it.
 */
const bookmarkSchema = z.strictObject({
  /** The row's label, which queries match. */
  name: z.string(),
  url: z
    .string()
    .regex(/^https?:\/\/./i, "a bookmark's URL must be http or https"),
});

/** A shell's bookmarks, as its config gives them. */
export const bookmarksSchema = z.array(bookmarkSchema).readonly();

export type Bookmark = z.infer<typeof bookmarkSchema>;

/**
 * Up to `limit` bookmarks matching `query`, best first.
 *
 * Matches as `findApps` does, so rows agree: every query word must appear,
 * case-insensitively, in the name or URL.
 */
export const findBookmarks = (
  bookmarks: readonly Bookmark[],
  query: string,
  limit: number,
): Bookmark[] =>
  ranked(bookmarks, query, limit, {
    name: ({ name }) => name,
    tieBreak: ({ url }) => url,
    words: ({ name, url }) => `${name} ${url}`.toLowerCase(),
  });
