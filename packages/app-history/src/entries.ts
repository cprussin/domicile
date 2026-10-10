// The loaded rows, as later pages and day headers see them.

import type { Entry } from "./history-page";

/** A day header and its rows. */
export type Day = { day: number; entries: Entry[] };

/**
 * `loaded` followed by `page`'s rows. A row of `page` for a page and day
 * already loaded adds its older visits to that row instead.
 */
export const appendEntries = (
  loaded: readonly Entry[],
  page: readonly Entry[],
): Entry[] => {
  const older = new Map(page.map((row) => [row.id, row]));
  const ids = new Set(loaded.map((row) => row.id));
  return [
    ...loaded.map((row) => {
      const more = older.get(row.id);
      return more === undefined
        ? row
        : { ...row, visits: [...more.visits, ...row.visits] };
    }),
    ...page.filter((row) => !ids.has(row.id)),
  ];
};

/** `entries`, newest first, under their days. */
export const groupByDay = (entries: readonly Entry[]): Day[] =>
  [...Map.groupBy(entries, (row) => row.day)].map(([day, rows]) => ({
    day,
    entries: rows,
  }));
