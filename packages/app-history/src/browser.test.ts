import { describe, expect, it } from "bun:test";

import type { ChromeApi } from "./browser";
import { chromeBrowser } from "./browser";

const ORIGIN = "chrome-extension://dimbckmbklbplcobppahmnepgiponamj/";

/** A fake `chrome` that answers with `answers` and records each call. */
const fakeChrome = (
  answers: { search?: unknown; getVisits?: unknown } = {},
) => {
  const calls: [string, ...unknown[]][] = [];
  const event = (name: string) => ({
    addListener: (listener: () => void) => {
      calls.push([`${name}.addListener`, listener]);
    },
    removeListener: (listener: () => void) => {
      calls.push([`${name}.removeListener`, listener]);
    },
  });
  const record =
    (name: string, answer?: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve(answer);
    };
  const api: ChromeApi = {
    browsingData: { remove: record("browsingData.remove") },
    history: {
      deleteRange: record("history.deleteRange"),
      getVisits: record("history.getVisits", answers.getVisits),
      onVisited: event("onVisited"),
      onVisitRemoved: event("onVisitRemoved"),
      search: record("history.search", answers.search),
    },
    runtime: {
      getURL: (path: string) => `${ORIGIN}${path.replace(/^\//, "")}`,
    },
    tabs: { create: record("tabs.create") },
  };
  return { api, calls };
};

describe(chromeBrowser, () => {
  describe("history", () => {
    it("searches the whole history before `endTime`", async () => {
      const { api, calls } = fakeChrome({
        search: [
          { id: "1", title: "A", url: "https://a.test/" },
          { id: "2", url: "https://b.test/" },
        ],
      });
      expect(
        await chromeBrowser(api).search({
          endTime: 5,
          maxResults: 150,
          text: "a",
        }),
      ).toEqual([
        { title: "A", url: "https://a.test/" },
        { title: "", url: "https://b.test/" },
      ]);
      expect(calls).toEqual([
        [
          "history.search",
          { endTime: 5, maxResults: 150, startTime: 0, text: "a" },
        ],
      ]);
    });

    it("rejects a result it can't read", () => {
      const { api } = fakeChrome({ search: [{ title: "A" }] });
      expect(
        chromeBrowser(api).search({ endTime: 5, maxResults: 1, text: "" }),
      ).rejects.toThrow();
    });

    it("gives a page's visit times", async () => {
      const { api, calls } = fakeChrome({
        getVisits: [
          { id: "1", visitId: "1", visitTime: 10.5 },
          { id: "1", visitId: "2", visitTime: 20 },
        ],
      });
      expect(await chromeBrowser(api).getVisits("https://a.test/")).toEqual([
        10.5, 20,
      ]);
      expect(calls).toEqual([
        ["history.getVisits", { url: "https://a.test/" }],
      ]);
    });

    it("deletes each visit by the few microseconds around it", async () => {
      const { api, calls } = fakeChrome();
      await chromeBrowser(api).deleteVisits([1000, 2000]);
      expect(calls).toEqual([
        ["history.deleteRange", { endTime: 1000.002, startTime: 999.998 }],
        ["history.deleteRange", { endTime: 2000.002, startTime: 1999.998 }],
      ]);
    });

    it("reports visits and removals until stopped", () => {
      const { api, calls } = fakeChrome();
      const changed = () => undefined;
      const stop = chromeBrowser(api).onChange(changed);
      stop();
      expect(calls).toEqual([
        ["onVisited.addListener", changed],
        ["onVisitRemoved.addListener", changed],
        ["onVisited.removeListener", changed],
        ["onVisitRemoved.removeListener", changed],
      ]);
    });
  });

  it("clears browsing data since a time", async () => {
    const { api, calls } = fakeChrome();
    await chromeBrowser(api).removeBrowsingData(42, { cache: true });
    expect(calls).toEqual([
      ["browsingData.remove", { since: 42 }, { cache: true }],
    ]);
  });

  it("opens a page in a new window", async () => {
    const { api, calls } = fakeChrome();
    await chromeBrowser(api).openInNewWindow("https://a.test/");
    expect(calls).toEqual([["tabs.create", { url: "https://a.test/" }]]);
  });

  it("copies text to the clipboard", async () => {
    const copied = await new Promise((resolve) => {
      chromeBrowser(fakeChrome().api, {
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

  it("knows its own pages' origin", () => {
    expect(chromeBrowser(fakeChrome().api).hiddenOrigin).toBe(ORIGIN);
  });

  it("gives a page's favicon from the extension's favicon service", () => {
    expect(
      chromeBrowser(fakeChrome().api).faviconUrl("https://a.test/?q=1"),
    ).toBe(
      `${ORIGIN}_favicon/?pageUrl=https%3A%2F%2Fa.test%2F%3Fq%3D1&size=32`,
    );
  });
});
