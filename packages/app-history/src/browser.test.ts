import { describe, expect, it } from "bun:test";

import { hostBrowser } from "./browser";
import type { HistoryHost } from "./host";

/** A host that records each call and answers with `answers`. */
const fakeHost = (
  answers: Partial<Pick<HistoryHost, "history" | "visits">> = {},
) => {
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve();
    };
  const host: HistoryHost = {
    clearBrowsingData: record("clearBrowsingData"),
    deleteHistory: record("deleteHistory"),
    history: answers.history ?? (() => Promise.resolve([])),
    openUrl: record("openUrl"),
    visits: answers.visits ?? (() => Promise.resolve([])),
  };
  return { calls, host };
};

/** A window and document the test focuses and shows. */
const fakePage = () => {
  const document = Object.assign(new EventTarget(), {
    visibilityState: "hidden" as DocumentVisibilityState,
  });
  return { document, window: new EventTarget() };
};

/** The browser over `host`, with a fake page and no clipboard. */
const browserOver = (host: HistoryHost, page = fakePage()) =>
  hostBrowser(host, page, {
    writeText: () => Promise.reject(new Error("no clipboard")),
  });

/** Counts the calls `browser.onChange` makes until stopped. */
const counted = (browser: ReturnType<typeof hostBrowser>) => {
  const count = { changes: 0 };
  const stop = browser.onChange(() => {
    count.changes += 1;
  });
  return { count, stop };
};

describe(hostBrowser, () => {
  it("searches the history and gives a page's visits", async () => {
    const item = { favicon: undefined, title: "A", url: "https://a.test/" };
    const browser = browserOver(
      fakeHost({
        history: (query) => {
          expect(query).toEqual({ endTime: 5, maxResults: 150, text: "a" });
          return Promise.resolve([item]);
        },
        visits: (url) => Promise.resolve(url === item.url ? [10.5, 20] : []),
      }).host,
    );
    expect(
      await browser.search({ endTime: 5, maxResults: 150, text: "a" }),
    ).toEqual([item]);
    expect(await browser.getVisits(item.url)).toEqual([10.5, 20]);
  });

  it("deletes visits, then reports a change", async () => {
    const { calls, host } = fakeHost();
    const browser = browserOver(host);
    const { count } = counted(browser);
    await browser.deleteVisits([1000, 2000]);
    expect(calls).toEqual([["deleteHistory", [1000, 2000]]]);
    expect(count.changes).toBe(1);
  });

  it("clears browsing data since a time, then reports a change", async () => {
    const { calls, host } = fakeHost();
    const browser = browserOver(host);
    const { count } = counted(browser);
    await browser.removeBrowsingData(42, ["cache", "history"]);
    expect(calls).toEqual([
      ["clearBrowsingData", { since: 42, types: ["cache", "history"] }],
    ]);
    expect(count.changes).toBe(1);
  });

  it("clears cookies and site data for a page's origin", async () => {
    const { calls, host } = fakeHost();
    await browserOver(host).clearSiteData("https://a.test:8080/b?c=1");
    expect(calls).toEqual([
      [
        "clearBrowsingData",
        {
          origins: ["https://a.test:8080"],
          since: 0,
          types: [
            "cacheStorage",
            "cookies",
            "fileSystems",
            "indexedDB",
            "localStorage",
            "serviceWorkers",
            "webSQL",
          ],
        },
      ],
    ]);
  });

  it("reports a change when the window gains focus or is shown, until stopped", () => {
    const page = fakePage();
    const { count, stop } = counted(browserOver(fakeHost().host, page));
    page.window.dispatchEvent(new Event("focus"));
    page.document.dispatchEvent(new Event("visibilitychange"));
    page.document.visibilityState = "visible";
    page.document.dispatchEvent(new Event("visibilitychange"));
    expect(count.changes).toBe(2);

    stop();
    page.window.dispatchEvent(new Event("focus"));
    page.document.dispatchEvent(new Event("visibilitychange"));
    expect(count.changes).toBe(2);
  });

  it("stops reporting its own changes once stopped", async () => {
    const browser = browserOver(fakeHost().host);
    const { count, stop } = counted(browser);
    stop();
    await browser.deleteVisits([1000]);
    expect(count.changes).toBe(0);
  });

  it("opens a page in a new window", async () => {
    const { calls, host } = fakeHost();
    await browserOver(host).openInNewWindow("https://a.test/");
    expect(calls).toEqual([["openUrl", "https://a.test/"]]);
  });

  it("copies text to the clipboard", async () => {
    const copied = await new Promise((resolve) => {
      hostBrowser(fakeHost().host, fakePage(), {
        writeText: (text) => {
          resolve(text);
          return Promise.resolve();
        },
      })
        .copyText("https://a.test/")
        .catch(() => undefined);
    });
    expect(copied).toBe("https://a.test/");
  });
});
