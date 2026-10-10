// A history for tests that answers queries the way Chrome's HistoryService
// does. Not part of the app.

import type { Browser } from "./browser";
import type { HistoryItem, HistorySource } from "./history-page";

/** One page in the fake history: its title and visit times. */
export type FakePage = { title: string; url: string; visits: number[] };

/**
 * A {@link HistorySource} over `pages`. `search` returns the pages with a
 * visit before `endTime` whose title or URL holds `text`, ordered by their
 * latest such visit, newest first, at most `maxResults` of them.
 */
export const fakeHistory = (pages: FakePage[]): HistorySource => ({
  getVisits: (url) => Promise.resolve(findPage(pages, url).visits),
  search: ({ endTime, maxResults, text }) =>
    Promise.resolve(
      pages
        .flatMap((page) => {
          const latest = Math.max(
            ...page.visits.filter((visit) => visit < endTime),
          );
          return latest === Number.NEGATIVE_INFINITY ||
            !`${page.title} ${page.url}`.includes(text)
            ? []
            : [{ latest, page }];
        })
        .toSorted((a, b) => b.latest - a.latest)
        .slice(0, maxResults)
        .map(({ page }): HistoryItem => ({ title: page.title, url: page.url })),
    ),
});

const findPage = (pages: FakePage[], url: string): FakePage => {
  const page = pages.find((candidate) => candidate.url === url);
  if (page === undefined) {
    throw new Error(`no visits for ${url}`);
  } else {
    return page;
  }
};

/**
 * A {@link Browser} over `pages` that deletes from them and tells `onChange`
 * listeners when it does. `changed` tells them too. Unused parts throw.
 */
export const fakeBrowser = (pages: FakePage[]) => {
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  const unused = () => {
    throw new Error("not faked");
  };
  const browser: Browser = {
    ...fakeHistory(pages),
    copyText: unused,
    deleteVisits: (visits) => {
      for (const page of pages) {
        page.visits = page.visits.filter((visit) => !visits.includes(visit));
      }
      changed();
      return Promise.resolve();
    },
    faviconUrl: (pageUrl) => `favicon:${pageUrl}`,
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openInNewWindow: unused,
    removeBrowsingData: unused,
  };
  return { browser, changed };
};
