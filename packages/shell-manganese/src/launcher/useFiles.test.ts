import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { HostMessageOf } from "@domicile/chrome-sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { useFiles } from "./useFiles";

/**
 * A stand-in for the client: it counts the asking and lets a test answer.
 *
 * Narrower than a `DomicileClient` because the hook uses two of its members,
 * and a double that implemented the other fifteen would be saying so wrongly —
 * the cast is what keeps the stand-in the size of the seam.
 */
const client = () => {
  const asked: number[] = [];
  let handler: ((message: HostMessageOf<"files">) => void) | undefined;
  const domicile = {
    listFiles: () => {
      asked.push(asked.length);
    },
    on: (
      _type: "files",
      registered: (message: HostMessageOf<"files">) => void,
    ) => {
      handler = registered;
    },
  } as unknown as DomicileClient;

  return {
    answers: (files: readonly string[], indexing = false) => {
      act(() => {
        handler?.({ files, indexing });
      });
    },
    asked: () => asked.length,
    domicile,
  };
};

describe("useFiles", () => {
  it("has nothing to offer before the host has answered", () => {
    // Not an error state and nothing to say about it: a launcher opening on an
    // empty list looks the same as one opening on a home with nothing in it,
    // and both are a box you can still type a URL into.
    //
    // Not "still being built" either, which is a claim rather than an absence:
    // nothing has said so, and a panel that announced an index it has heard
    // nothing about would be guessing on the compositor's behalf.
    const host = client();

    const { result } = renderHook(() => useFiles(host.domicile, true));

    expect(result.current).toStrictEqual({ files: [], indexing: false });
  });

  it("asks nothing of the host while the panel is shut", () => {
    // Which is most of the time. A desktop that walked the home directory on
    // every keystroke of every window would be paying for a panel nobody has
    // opened.
    const host = client();

    renderHook(() => useFiles(host.domicile, false));

    expect(host.asked()).toBe(0);
  });

  it("asks as the panel opens, and offers what comes back", () => {
    const host = client();
    const { rerender, result } = renderHook(
      ({ open }) => useFiles(host.domicile, open),
      { initialProps: { open: false } },
    );

    act(() => {
      rerender({ open: true });
    });
    host.answers(["Notes/today.org", "src"]);

    expect(host.asked()).toBe(1);
    expect(result.current).toStrictEqual({
      files: ["Notes/today.org", "src"],
      indexing: false,
    });
  });

  it("asks again every time it opens, because a page can have missed one", () => {
    // The compositor pushes this too, so a panel left open is kept current —
    // but a push only reaches the pages connected for it, and a page that has
    // just reloaded has no list at all. Asking on each open is what stops a
    // launcher being empty until the next time a file is saved.
    const host = client();
    const { rerender } = renderHook(
      ({ open }) => useFiles(host.domicile, open),
      { initialProps: { open: true } },
    );

    act(() => {
      rerender({ open: false });
    });
    act(() => {
      rerender({ open: true });
    });

    expect(host.asked()).toBe(2);
  });

  it("says when the list is not all of the home yet", () => {
    // WHAT A PANEL DRAWS ITS WARNING FROM. The list is the launcher's whole
    // evidence that a file exists, so one that came out of an index still
    // being walked has to be drawn as incomplete — otherwise the person who
    // typed a name the walk has not reached is told they have no such file.
    const host = client();
    const { result } = renderHook(() => useFiles(host.domicile, true));

    host.answers(["src"], true);

    expect(result.current).toStrictEqual({ files: ["src"], indexing: true });
  });

  it("takes an answer nobody asked for, so an open panel fills in", () => {
    // The index finishes while the panel is up, which is exactly when it
    // matters: a person is typing at a list that is a third of their home, and
    // the rest of it arrives without them pressing anything.
    const host = client();
    const { result } = renderHook(() => useFiles(host.domicile, true));

    host.answers(["src"], true);
    host.answers(["Notes", "src"], false);

    expect(result.current).toStrictEqual({
      files: ["Notes", "src"],
      indexing: false,
    });
  });
});
