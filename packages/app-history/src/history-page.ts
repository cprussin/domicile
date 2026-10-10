// Pages through the history the way chrome://history does: newest first, one
// row per page per day.

import { startOfDay } from "./day";
import { appendEntries } from "./entries";

/**
 * Schemes of pages the list leaves out: Domicile's own, such as the shell's
 * `domicile://shell/`, and extensions', this app's included.
 */
const HIDDEN_SCHEMES = ["domicile:", "chrome-extension:"];

/** A page in the history, as `chrome.history.search` gives it. */
export type HistoryItem = { title: string; url: string };

/** The parts of `chrome.history` the list reads. */
export type HistorySource = {
  /**
   * Pages with a visit before `endTime` whose title or URL matches `text`,
   * ordered by their latest such visit, newest first.
   */
  search: (query: {
    endTime: number;
    maxResults: number;
    text: string;
  }) => Promise<readonly HistoryItem[]>;
  /** The times of every visit to `url`. */
  getVisits: (url: string) => Promise<readonly number[]>;
};

/** One row: a page's visits on one day. */
export type Entry = {
  /** The day's local midnight. */
  day: number;
  id: string;
  /** The latest of `visits`. */
  time: number;
  title: string;
  url: string;
  /** Every visit to `url` on `day`, oldest first. */
  visits: readonly number[];
};

export type PageQuery = {
  /** Only visits before this time. */
  endTime: number;
  maxResults: number;
  text: string;
};

/** A page of rows, and the `endTime` of the next, if there is more. */
export type Page = {
  entries: Entry[];
  next: number | undefined;
};

/**
 * Loads the visits before `endTime`, as rows.
 *
 * `search` gives up to `maxResults` pages, but each may have older visits
 * than the oldest page's latest one, and pages past `maxResults` may have
 * visits after it. So a full page keeps only the visits from that time on and
 * the next page starts there. A page with fewer results holds everything.
 */
export const loadPage = async (
  source: HistorySource,
  { endTime, maxResults, text }: PageQuery,
): Promise<Page> => {
  const items = await source.search({ endTime, maxResults, text });
  const visited = await Promise.all(
    items.map(async (item) => ({
      item,
      visits: (await source.getVisits(item.url))
        .filter((visit) => visit < endTime)
        .toSorted((a, b) => a - b),
    })),
  );
  const next =
    items.length < maxResults
      ? undefined
      : Math.min(
          ...visited.map(({ item, visits }) => latest(item, visits, endTime)),
        );
  const cutoff = next ?? Number.NEGATIVE_INFINITY;
  return {
    entries: visited
      .filter(({ item }) => !hidden(item.url))
      .flatMap(({ item, visits }) =>
        byDay(
          item,
          visits.filter((visit) => visit >= cutoff),
        ),
      )
      .toSorted((a, b) => b.time - a.time),
    next,
  };
};

/**
 * Loads pages from `query.endTime` until one reaches back to `until`, as one.
 * Reloads what is on screen after the history changes.
 */
export const loadSince = async (
  source: HistorySource,
  until: number,
  query: PageQuery,
): Promise<Page> => {
  const page = await loadPage(source, query);
  if (page.next === undefined || page.next <= until) {
    return page;
  } else {
    const rest = await loadSince(source, until, {
      ...query,
      endTime: page.next,
    });
    return {
      entries: appendEntries(page.entries, rest.entries),
      next: rest.next,
    };
  }
};

/** `item`'s rows, one per day of `visits`. */
const byDay = (item: HistoryItem, visits: readonly number[]): Entry[] =>
  [...Map.groupBy(visits, startOfDay)].map(([day, onDay]) => ({
    day,
    id: `${day} ${item.url}`,
    time: Math.max(...onDay),
    title: item.title,
    url: item.url,
    visits: onDay,
  }));

/** The latest of `visits`, which `search` promised has one before `endTime`. */
const latest = (
  item: HistoryItem,
  visits: readonly number[],
  endTime: number,
): number => {
  const visit = visits.at(-1);
  if (visit === undefined) {
    throw new Error(`${item.url} has no visit before ${endTime}`);
  } else {
    return visit;
  }
};

/**
 * Whether `url` is a page the list leaves out. Chrome records the shell's
 * window and extensions' pages like any tab's. App windows record nothing
 * (docs/HISTORY.md).
 */
const hidden = (url: string): boolean =>
  HIDDEN_SCHEMES.some((scheme) => url.startsWith(scheme));
