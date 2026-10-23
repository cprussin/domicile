import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import type { Folders } from "./folders";
import { Listing, useListing } from "./useListing";

/** Folders that list with `list` and are never watched to change. */
const unchanging = (list: Folders["list"]): Folders => ({
  create: () => {
    throw new Error("unexpected create");
  },
  list,
  watch: () => () => undefined,
});

/** Folders listed from `entries`, which the test changes and announces. */
const changing = (entries: Map<string, readonly string[]>) => {
  const watchers = new Map<string, () => void>();
  const folders: Folders = {
    create: () => {
      throw new Error("unexpected create");
    },
    list: (path) => {
      const listed = entries.get(path);
      return listed === undefined
        ? Promise.reject(new DOMException(path, "NotReadableError"))
        : Promise.resolve(listed);
    },
    watch: (path, changed) => {
      watchers.set(path, changed);
      return () => {
        watchers.delete(path);
      };
    },
  };
  return { folders, watchers };
};

describe("useListing", () => {
  // Each `folders` is created outside render, since a new one re-runs the
  // listing.
  it("is what the engine listed for the directory browsed", async () => {
    const folders = unchanging((path) => Promise.resolve([`${path}-a`]));
    const { result } = renderHook(() => useListing(folders, "/mnt"));

    expect(result.current).toStrictEqual(Listing.Loading());
    await act(() => Promise.resolve());
    expect(result.current).toStrictEqual(Listing.Listed(["/mnt-a"]));
  });

  // Distinct from an empty directory.
  it("is unreadable when the engine refuses", async () => {
    const folders = unchanging(() =>
      Promise.reject(new DOMException("no", "NotReadableError")),
    );
    const { result } = renderHook(() => useListing(folders, "/root"));

    await act(() => Promise.resolve());
    expect(result.current).toStrictEqual(Listing.Unreadable());
  });

  // Typing can outpace the engine, so stale results are dropped.
  it("drops an answer for a directory no longer browsed", async () => {
    const answers = new Map<string, (entries: readonly string[]) => void>();
    const folders = unchanging(
      (path) =>
        new Promise<readonly string[]>((resolve) => {
          answers.set(path, resolve);
        }),
    );
    const { rerender, result } = renderHook(
      ({ directory }) => useListing(folders, directory),
      { initialProps: { directory: "/a" } },
    );
    rerender({ directory: "/b" });

    await act(async () => {
      answers.get("/b")?.(["b"]);
      answers.get("/a")?.(["a"]);
      await Promise.resolve();
    });

    expect(result.current).toStrictEqual(Listing.Listed(["b"]));
  });

  describe("watching", () => {
    it("lists again when the directory changes", async () => {
      const entries = new Map([["/a", ["old"]]]);
      const { folders, watchers } = changing(entries);
      const { result } = renderHook(() => useListing(folders, "/a"));
      await act(() => Promise.resolve());

      entries.set("/a", ["old", "new"]);
      await act(async () => {
        watchers.get("/a")?.();
        await Promise.resolve();
      });

      expect(result.current).toStrictEqual(Listing.Listed(["old", "new"]));
    });

    it("lists once more after changes heard while listing", async () => {
      const entries = new Map([["/a", ["one"]]]);
      const { folders, watchers } = changing(entries);
      const listed: string[] = [];
      const counted: Folders = {
        ...folders,
        list: (path) => {
          listed.push(path);
          return folders.list(path);
        },
      };
      const { result } = renderHook(() => useListing(counted, "/a"));
      await act(() => Promise.resolve());

      entries.set("/a", ["one", "two", "three"]);
      await act(async () => {
        watchers.get("/a")?.();
        watchers.get("/a")?.();
        watchers.get("/a")?.();
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      });

      expect(listed).toStrictEqual(["/a", "/a", "/a"]);
      expect(result.current).toStrictEqual(
        Listing.Listed(["one", "two", "three"]),
      );
    });

    it("watches only a directory it could list, until it leaves", async () => {
      const entries = new Map([["/a", []]]);
      const { folders, watchers } = changing(entries);
      const { rerender } = renderHook(
        ({ directory }) => useListing(folders, directory),
        { initialProps: { directory: "/a" } },
      );
      await act(() => Promise.resolve());
      expect([...watchers.keys()]).toStrictEqual(["/a"]);

      rerender({ directory: "/root" });
      await act(() => Promise.resolve());

      expect([...watchers.keys()]).toStrictEqual([]);
    });
  });
});
