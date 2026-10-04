import { describe, expect, it } from "bun:test";
import type { FoundFilesMessage } from "@domicile-desktop/sdk/host-message";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useFound } from "./useFound";

/** Fake host search that records queries so a test can answer in any order. */
const host = () => {
  const asked: { query: string; settle: (found: FoundFilesMessage) => void }[] =
    [];
  const search = (query: string) =>
    new Promise<FoundFilesMessage>((settle) => {
      asked.push({ query, settle });
    });
  return {
    answers: async (
      at: number,
      files: readonly string[],
      indexing = false,
    ): Promise<void> => {
      const asking = asked[at];
      if (asking === undefined) {
        throw new Error(`nothing was asked at ${at.toString()}`);
      } else {
        await act(async () => {
          asking.settle({
            files,
            indexing,
            matched: files.length,
            query: asking.query,
          });
          await Promise.resolve();
        });
      }
    },
    asked: () => asked.map(({ query }) => query),
    search,
  };
};

describe("useFound", () => {
  it("has found nothing before the host has answered", () => {
    // Not "indexing" either: the host hasn't said so.
    const home = host();

    const { result } = renderHook(() => useFound(home.search, ""));

    expect(home.asked()).toStrictEqual([""]);
    expect(result.current).toStrictEqual({
      files: [],
      indexing: false,
      matched: 0,
    });
  });

  it("asks for what the box says, and holds what comes back", async () => {
    const home = host();
    const { result } = renderHook(() => useFound(home.search, "notes"));

    await home.answers(0, ["Notes/", "Notes/today.org"]);

    expect(result.current).toStrictEqual({
      files: ["Notes/", "Notes/today.org"],
      indexing: false,
      matched: 2,
    });
  });

  it("keeps the answer to the box when a keystroke ago's arrives after it", async () => {
    // Answers can arrive out of order; only the current query's is used.
    const home = host();
    const { rerender, result } = renderHook(
      ({ query }) => useFound(home.search, query),
      { initialProps: { query: "n" } },
    );
    rerender({ query: "no" });

    await home.answers(1, ["Notes/"]);
    await home.answers(0, ["Notes/", "src/nix/"]);

    expect(result.current.files).toStrictEqual(["Notes/"]);
  });

  it("asks again while the home is still being walked", async () => {
    // A half-built index returns partial results, and nothing signals when
    // more are found, so the hook polls.
    const home = host();
    const { result } = renderHook(() => useFound(home.search, "plan"));

    await home.answers(0, [], true);
    await waitFor(
      () => {
        expect(home.asked()).toStrictEqual(["plan", "plan"]);
      },
      { timeout: 2000 },
    );
    await home.answers(1, ["Notes/plan.org"]);

    expect(result.current.files).toStrictEqual(["Notes/plan.org"]);
  });
});
