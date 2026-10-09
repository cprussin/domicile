import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { Browser } from "./browser";
import { startOfDay } from "./day";
import { Failure } from "./failure";
import type { FakePage } from "./fake-history";
import { fakeBrowser } from "./fake-history";
import { useHistory } from "./useHistory";

const at = (minute: number) => new Date(2026, 9, 9, 12, minute).getTime();
const NOW = () => at(59);

/** `count` pages, one visit each, a minute apart, newest first. */
const pages = (count: number): FakePage[] =>
  Array.from({ length: count }, (_, index) => ({
    title: `Page ${index}`,
    url: `https://${index}.test/`,
    visits: [at(50 - index)],
  }));

const urls = (entries: readonly { url: string }[]) =>
  entries.map((entry) => entry.url);

/**
 * `browser`, but while `shut` its searches wait, and its visit lookups answer
 * with the visits as they were, until `open`.
 */
const gated = (browser: Browser) => {
  const waiting: (() => void)[] = [];
  const gate = {
    open: () => {
      for (const resolve of waiting.splice(0)) {
        resolve();
      }
    },
    shut: false,
    waiting,
  };
  const wait = () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  const wrapped: Browser = {
    ...browser,
    getVisits: async (url) => {
      const visits = await browser.getVisits(url);
      if (gate.shut) {
        await wait();
      }
      return visits;
    },
    search: async (query) => {
      if (gate.shut) {
        await wait();
      }
      return browser.search(query);
    },
  };
  return { browser: wrapped, gate };
};

describe(useHistory, () => {
  it("loads the newest page of history", async () => {
    const { browser } = fakeBrowser(pages(2));
    const { result } = renderHook(() =>
      useHistory({ browser, now: NOW, pageSize: 5, text: "" }),
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(urls(result.current.entries)).toEqual([
      "https://0.test/",
      "https://1.test/",
    ]);
    expect(result.current.complete).toBe(true);
  });

  it("loads more pages on request", async () => {
    const { browser } = fakeBrowser(pages(3));
    const { result } = renderHook(() =>
      useHistory({ browser, now: NOW, pageSize: 2, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    expect(result.current.complete).toBe(false);
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(3);
    });
  });

  it("starts over for a new search", async () => {
    const { browser } = fakeBrowser(pages(3));
    const { rerender, result } = renderHook(
      ({ text }) => useHistory({ browser, now: NOW, pageSize: 5, text }),
      { initialProps: { text: "" } },
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(3);
    });
    rerender({ text: "Page 1" });
    await waitFor(() => {
      expect(urls(result.current.entries)).toEqual(["https://1.test/"]);
    });
  });

  it("deletes rows' visits, then lets the rows leave", async () => {
    const history = pages(2);
    const { browser } = fakeBrowser(history);
    const { result } = renderHook(() =>
      useHistory({ browser, now: NOW, pageSize: 5, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    const id = `${startOfDay(at(50))} https://0.test/`;
    act(() => {
      result.current.remove(new Set([id]));
    });
    await waitFor(() => {
      expect(result.current.leaving).toEqual(new Set([id]));
    });
    expect(history[0]?.visits).toEqual([]);
    act(() => {
      result.current.settle(id);
    });
    expect(urls(result.current.entries)).toEqual(["https://1.test/"]);
    expect(result.current.leaving).toEqual(new Set());
  });

  it("reloads the rows on screen when the history changes", async () => {
    const history = pages(1);
    const { browser, changed } = fakeBrowser(history);
    const { result } = renderHook(() =>
      useHistory({ browser, now: NOW, pageSize: 5, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    history.push({ title: "New", url: "https://new.test/", visits: [at(55)] });
    changed();
    await waitFor(() => {
      expect(urls(result.current.entries)).toEqual([
        "https://new.test/",
        "https://0.test/",
      ]);
    });
  });

  it("holds the error when loading fails", async () => {
    const { browser } = fakeBrowser(pages(1));
    const failing = {
      ...browser,
      search: () => Promise.reject(new Error("no history")),
    };
    const { result } = renderHook(() =>
      useHistory({ browser: failing, now: NOW, pageSize: 5, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.failure).toEqual(
        Failure.Load(new Error("no history")),
      );
    });
    expect(result.current.loading).toBe(false);
  });

  it("keeps rows whose removal fails, with the error", async () => {
    const { browser } = fakeBrowser(pages(1));
    const failing = {
      ...browser,
      deleteVisits: () => Promise.reject(new Error("locked")),
    };
    const { result } = renderHook(() =>
      useHistory({ browser: failing, now: NOW, pageSize: 5, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    act(() => {
      result.current.remove(new Set([`${startOfDay(at(50))} https://0.test/`]));
    });
    await waitFor(() => {
      expect(result.current.failure).toEqual(
        Failure.Remove(new Error("locked")),
      );
    });
    expect(() => {
      result.current.retry();
    }).toThrow("nothing to try again");
    expect(result.current.leaving).toEqual(new Set());
    expect(result.current.entries).toHaveLength(1);
  });

  it("still reloads when more rows load while a change waits", async () => {
    const history = pages(2);
    const { browser, changed } = fakeBrowser(history);
    const { result } = renderHook(() =>
      useHistory({ browser, now: NOW, pageSize: 1, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    history.push({ title: "New", url: "https://new.test/", visits: [at(55)] });
    changed();
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(urls(result.current.entries)).toContain("https://new.test/");
    });
  });

  it("doesn't bring back a row that left while more rows loaded", async () => {
    const gate: { open: () => void; shut: boolean } = {
      open: () => undefined,
      shut: false,
    };
    const { browser } = fakeBrowser(pages(3));
    const gated = {
      ...browser,
      search: async (query: Parameters<typeof browser.search>[0]) => {
        if (gate.shut) {
          await new Promise<void>((resolve) => {
            gate.open = resolve;
          });
        }
        return browser.search(query);
      },
    };
    const { result } = renderHook(() =>
      useHistory({ browser: gated, now: NOW, pageSize: 2, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    const id = `${startOfDay(at(50))} https://0.test/`;
    gate.shut = true;
    act(() => {
      result.current.loadMore();
      result.current.remove(new Set([id]));
    });
    await waitFor(() => {
      expect(result.current.leaving).toEqual(new Set([id]));
    });
    act(() => {
      result.current.settle(id);
    });
    act(() => {
      gate.open();
    });
    await waitFor(() => {
      expect(urls(result.current.entries)).toEqual([
        "https://1.test/",
        "https://2.test/",
      ]);
    });
  });

  it("forgets leaving rows the list no longer shows", async () => {
    const { browser } = fakeBrowser(pages(2));
    const { rerender, result } = renderHook(
      ({ text }) => useHistory({ browser, now: NOW, pageSize: 5, text }),
      { initialProps: { text: "" } },
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    const id = `${startOfDay(at(50))} https://0.test/`;
    act(() => {
      result.current.remove(new Set([id]));
    });
    await waitFor(() => {
      expect(result.current.leaving).toEqual(new Set([id]));
    });
    rerender({ text: "Page" });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.leaving).toEqual(new Set());
  });

  it("keeps a reload's answer when more rows are asked for meanwhile", async () => {
    const history = pages(2);
    const fake = fakeBrowser(history);
    const { browser, gate } = gated(fake.browser);
    const { result } = renderHook(() =>
      useHistory({ browser, now: NOW, pageSize: 1, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    gate.shut = true;
    history.push({ title: "New", url: "https://new.test/", visits: [at(55)] });
    fake.changed();
    await waitFor(() => {
      expect(gate.waiting.length).toBeGreaterThan(0);
    });
    act(() => {
      result.current.loadMore();
    });
    gate.shut = false;
    act(() => {
      gate.open();
    });
    await waitFor(() => {
      expect(urls(result.current.entries)).toContain("https://new.test/");
    });
  });

  it("removes every visit to a row's page on the row's day", async () => {
    const yesterday = new Date(2026, 9, 8, 12, 0).getTime();
    const history: FakePage[] = [
      {
        title: "A",
        url: "https://a.test/",
        visits: [yesterday, at(10), at(50)],
      },
      { title: "B", url: "https://b.test/", visits: [at(30)] },
    ];
    const { browser } = fakeBrowser(history);
    const { result } = renderHook(() =>
      useHistory({ browser, now: NOW, pageSize: 1, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    act(() => {
      result.current.remove(new Set([`${startOfDay(at(50))} https://a.test/`]));
    });
    await waitFor(() => {
      expect(result.current.leaving.size).toBe(1);
    });
    expect(history[0]?.visits).toEqual([yesterday]);
  });

  it("doesn't bring back a removed row from a page loaded before it went", async () => {
    const history: FakePage[] = [
      { title: "A", url: "https://a.test/", visits: [at(10), at(50)] },
      { title: "B", url: "https://b.test/", visits: [at(40)] },
      { title: "C", url: "https://c.test/", visits: [at(20)] },
    ];
    const { browser, gate } = gated(fakeBrowser(history).browser);
    const { result } = renderHook(() =>
      useHistory({ browser, now: NOW, pageSize: 2, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    const id = `${startOfDay(at(50))} https://a.test/`;
    gate.shut = true;
    act(() => {
      result.current.loadMore();
    });
    gate.open();
    await waitFor(() => {
      expect(gate.waiting.length).toBeGreaterThan(0);
    });
    gate.shut = false;
    act(() => {
      result.current.remove(new Set([id]));
    });
    await waitFor(() => {
      expect(result.current.leaving).toEqual(new Set([id]));
    });
    act(() => {
      result.current.settle(id);
    });
    act(() => {
      gate.open();
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(urls(result.current.entries)).toEqual([
      "https://b.test/",
      "https://c.test/",
    ]);
  });

  it("retries a page that failed to load", async () => {
    const { browser } = fakeBrowser(pages(3));
    const calls = { count: 0 };
    const flaky: Browser = {
      ...browser,
      search: (query) => {
        calls.count += 1;
        return calls.count === 2
          ? Promise.reject(new Error("busy"))
          : browser.search(query);
      },
    };
    const { result } = renderHook(() =>
      useHistory({ browser: flaky, now: NOW, pageSize: 2, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.failure).toEqual(
        Failure.LoadMore(new Error("busy")),
      );
    });
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(3);
    });
    expect(result.current.failure).toBeUndefined();
  });

  it("retries a reload that failed", async () => {
    const history = pages(1);
    const fake = fakeBrowser(history);
    const calls = { count: 0 };
    const flaky: Browser = {
      ...fake.browser,
      search: (query) => {
        calls.count += 1;
        return calls.count === 2
          ? Promise.reject(new Error("busy"))
          : fake.browser.search(query);
      },
    };
    const { result } = renderHook(() =>
      useHistory({ browser: flaky, now: NOW, pageSize: 5, text: "" }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    history.push({ title: "New", url: "https://new.test/", visits: [at(55)] });
    fake.changed();
    await waitFor(() => {
      expect(result.current.failure).toEqual(Failure.Reload(new Error("busy")));
    });
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(urls(result.current.entries)).toEqual([
        "https://new.test/",
        "https://0.test/",
      ]);
    });
  });
});
