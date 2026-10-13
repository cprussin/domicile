// Everything the app does outside the page, over the app host and the
// clipboard. The host pushes no events, so the history counts as changed when
// the window comes back into view and after the app's own removals.

import { DataKind, dataTypes } from "./clear-data";
import type { HistorySource } from "./history-page";
import type { HistoryHost } from "./host";

/** The window and document whose focus and visibility the app follows. */
export type Page = {
  document: EventTarget & { visibilityState: DocumentVisibilityState };
  window: EventTarget;
};

/** Everything the app does outside the page. */
export type Browser = HistorySource & {
  /** Removes the cookies and site data of `pageUrl`'s origin. */
  clearSiteData: (pageUrl: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  /** Removes the visits at exactly these times. */
  deleteVisits: (visits: readonly number[]) => Promise<void>;
  /** Calls `listener` whenever the history may have changed. */
  onChange: (listener: () => void) => () => void;
  openInNewWindow: (url: string) => Promise<void>;
  /** Removes data of `types`, in `DataTypeSet`'s names, changed since `since`. */
  removeBrowsingData: (
    since: number,
    types: readonly string[],
  ) => Promise<void>;
};

/** The app's {@link Browser}, over the app host. */
export const hostBrowser = (
  host: HistoryHost,
  page: Page = { document, window },
  clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard,
): Browser => {
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    clearSiteData: (pageUrl) =>
      host.clearBrowsingData({
        origins: [new URL(pageUrl).origin],
        since: 0,
        types: dataTypes(new Set([DataKind.Cookies])),
      }),
    copyText: (text) => clipboard.writeText(text),
    deleteVisits: async (visits) => {
      await host.deleteHistory(visits);
      changed();
    },
    getVisits: (pageUrl) => host.visits(pageUrl),
    onChange: (listener) => {
      const shown = () => {
        if (page.document.visibilityState === "visible") {
          listener();
        }
      };
      listeners.add(listener);
      page.window.addEventListener("focus", listener);
      page.document.addEventListener("visibilitychange", shown);
      return () => {
        listeners.delete(listener);
        page.window.removeEventListener("focus", listener);
        page.document.removeEventListener("visibilitychange", shown);
      };
    },
    openInNewWindow: (url) => host.openUrl(url),
    removeBrowsingData: async (since, types) => {
      await host.clearBrowsingData({ since, types });
      changed();
    },
    search: (query) => host.history(query),
  };
};
