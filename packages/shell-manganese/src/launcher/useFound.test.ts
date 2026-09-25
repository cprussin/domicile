import { describe, expect, it } from "bun:test";
import type { FoundFilesMessage } from "@domicile/chrome-sdk/host-message";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useFound } from "./useFound";

/**
 * A stand-in for the host's search: it records each query and lets a test
 * answer them in whatever order it likes, which is the order that matters.
 */
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
    // Not "still being built" either, which is a claim rather than an absence:
    // nothing has said so, and a panel that announced an index it has heard
    // nothing about would be guessing on the compositor's behalf.
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
    // Somebody typing faster than the host answers has two searches in flight,
    // and the host owes them no order. The rows are for what is in the box.
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
    // WHAT FILLS THE PANEL IN UNDER THE PERSON TYPING. An answer from a
    // half-built index is only the files found so far, and nothing else will
    // tell this page when there are more.
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
