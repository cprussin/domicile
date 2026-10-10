// The extension APIs the app uses, with every answer parsed. `chrome` is the
// global an extension page gets; only the surface used here is declared.

import { z } from "zod";

import type { HistoryItem, HistorySource } from "./history-page";

/** A `chrome.*` event. */
type ChromeEvent = {
  addListener: (listener: () => void) => void;
  removeListener: (listener: () => void) => void;
};

/** The parts of the `chrome` global the app calls. */
export type ChromeApi = {
  browsingData: {
    remove: (
      options: { since: number },
      dataToRemove: Readonly<Record<string, boolean>>,
    ) => Promise<unknown>;
  };
  history: {
    deleteRange: (range: {
      endTime: number;
      startTime: number;
    }) => Promise<unknown>;
    getVisits: (details: { url: string }) => Promise<unknown>;
    onVisited: ChromeEvent;
    onVisitRemoved: ChromeEvent;
    search: (query: {
      endTime: number;
      maxResults: number;
      startTime: number;
      text: string;
    }) => Promise<unknown>;
  };
  runtime: { getURL: (path: string) => unknown };
  tabs: { create: (properties: { url: string }) => Promise<unknown> };
};

declare const chrome: ChromeApi;

/** Everything the app does outside the page. */
export type Browser = HistorySource & {
  copyText: (text: string) => Promise<void>;
  /** Removes the visits at exactly these times. */
  deleteVisits: (visits: readonly number[]) => Promise<void>;
  /** A 32px icon for `pageUrl`, from the browser's favicon cache. */
  faviconUrl: (pageUrl: string) => string;
  /** Calls `listener` whenever a visit is added or removed. */
  onChange: (listener: () => void) => () => void;
  openInNewWindow: (url: string) => Promise<void>;
  /** `chrome.browsingData.remove`, for data changed since `since`. */
  removeBrowsingData: (
    since: number,
    dataToRemove: Readonly<Record<string, boolean>>,
  ) => Promise<void>;
};

/**
 * Half the span deleted around each visit, in milliseconds. The API passes
 * microsecond visit times as fractional milliseconds and truncates them on
 * the way back, so an exact range could miss the visit by one microsecond.
 */
const VISIT_SLACK_MS = 0.002;

/** The app's {@link Browser}, over the extension APIs. */
export const chromeBrowser = (
  api: ChromeApi = chrome,
  clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard,
): Browser => {
  const url = (path: string) => z.string().parse(api.runtime.getURL(path));
  return {
    copyText: (text) => clipboard.writeText(text),
    deleteVisits: async (visits) => {
      for (const visit of visits) {
        await api.history.deleteRange({
          endTime: visit + VISIT_SLACK_MS,
          startTime: visit - VISIT_SLACK_MS,
        });
      }
    },
    faviconUrl: (pageUrl) =>
      url(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`),
    getVisits: async (pageUrl) =>
      visitsSchema
        .parse(await api.history.getVisits({ url: pageUrl }))
        .map((visit) => visit.visitTime),
    onChange: (listener) => {
      api.history.onVisited.addListener(listener);
      api.history.onVisitRemoved.addListener(listener);
      return () => {
        api.history.onVisited.removeListener(listener);
        api.history.onVisitRemoved.removeListener(listener);
      };
    },
    openInNewWindow: async (pageUrl) => {
      await api.tabs.create({ url: pageUrl });
    },
    removeBrowsingData: async (since, dataToRemove) => {
      await api.browsingData.remove({ since }, dataToRemove);
    },
    search: async ({ endTime, maxResults, text }) =>
      itemsSchema.parse(
        await api.history.search({ endTime, maxResults, startTime: 0, text }),
      ),
  };
};

const itemsSchema = z.array(
  z
    .object({ title: z.string().optional(), url: z.string() })
    .transform(({ title, url }): HistoryItem => ({ title: title ?? "", url })),
);

const visitsSchema = z.array(z.object({ visitTime: z.number() }));
