import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import { Listing, useListing } from "./useListing";

describe("useListing", () => {
  // Each `list` is created outside render, since a new one re-runs the
  // listing.
  it("is what the engine listed for the directory browsed", async () => {
    const list = (path: string) => Promise.resolve([`${path}-a`]);
    const { result } = renderHook(() => useListing(list, "/mnt"));

    expect(result.current).toStrictEqual(Listing.Loading());
    await act(() => Promise.resolve());
    expect(result.current).toStrictEqual(Listing.Listed(["/mnt-a"]));
  });

  // Distinct from an empty directory.
  it("is unreadable when the engine refuses", async () => {
    const list = () =>
      Promise.reject(new DOMException("no", "NotReadableError"));
    const { result } = renderHook(() => useListing(list, "/root"));

    await act(() => Promise.resolve());
    expect(result.current).toStrictEqual(Listing.Unreadable());
  });

  // Typing can outpace the engine, so stale results are dropped.
  it("drops an answer for a directory no longer browsed", async () => {
    const answers = new Map<string, (entries: readonly string[]) => void>();
    const list = (path: string) =>
      new Promise<readonly string[]>((resolve) => {
        answers.set(path, resolve);
      });
    const { rerender, result } = renderHook(
      ({ directory }) => useListing(list, directory),
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
});
