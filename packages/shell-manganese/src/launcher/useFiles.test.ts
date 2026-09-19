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
    answers: (files: readonly string[]) => {
      act(() => {
        handler?.({ files });
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
    const host = client();

    const { result } = renderHook(() => useFiles(host.domicile, true));

    expect(result.current).toStrictEqual([]);
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
    expect(result.current).toStrictEqual(["Notes/today.org", "src"]);
  });

  it("asks again every time it opens, because a home changes unwatched", () => {
    // Nothing pushes this: a file created in a terminal is not an event any
    // part of the desktop sees. Asking on each open is what keeps a launcher
    // from offering yesterday's home for the rest of the session.
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
});
