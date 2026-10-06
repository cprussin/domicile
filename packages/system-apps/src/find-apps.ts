// A launcher's search over installed applications.

import type { DesktopEntry } from "./desktop-entry";
import { ranked } from "./ranked";

/**
 * Up to `limit` applications matching `query`, best first.
 *
 * Every query word must appear, case-insensitively, in the name, generic name
 * or keywords. Names that start with the query rank first, then sort by name.
 */
export const findApps = (
  entries: readonly DesktopEntry[],
  query: string,
  limit: number,
): DesktopEntry[] =>
  ranked(entries, query, limit, {
    name: ({ name }) => name,
    tieBreak: ({ id }) => id,
    words: ({ words }) => words,
  });
