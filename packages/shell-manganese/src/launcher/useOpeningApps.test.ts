import { describe, expect, it } from "bun:test";
import type {
  DesktopEntry,
  FoundAppsMessage,
} from "@domicile/chrome-sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { useOpeningApps } from "./useOpeningApps";

const EDITOR: DesktopEntry = {
  command: ["gedit"],
  comment: "",
  icon: undefined,
  id: "gedit.desktop",
  name: "Text Editor",
  preview: undefined,
};

const PAINT: DesktopEntry = {
  command: ["paint"],
  comment: "",
  icon: undefined,
  id: "paint.desktop",
  name: "Paint",
  preview: undefined,
};

/** The host's search for applications, answered in whatever order a test says. */
const host = () => {
  const asked: { query: string; settle: (found: FoundAppsMessage) => void }[] =
    [];
  const searchApps = (query: string) =>
    new Promise<FoundAppsMessage>((settle) => {
      asked.push({ query, settle });
    });
  return {
    answers: async (
      at: number,
      apps: readonly DesktopEntry[],
    ): Promise<void> => {
      const asking = asked[at];
      if (asking === undefined) {
        throw new Error(`nothing was asked at ${at.toString()}`);
      } else {
        await act(async () => {
          asking.settle({ apps, bookmarks: [], query: asking.query });
          await Promise.resolve();
        });
      }
    },
    asked: () => asked.map(({ query }) => query),
    searchApps,
  };
};

describe("useOpeningApps", () => {
  it("asks for the empty box while the launcher is shut, and has its answer", async () => {
    const machine = host();
    const { result } = renderHook(() =>
      useOpeningApps(machine.searchApps, false),
    );

    expect(machine.asked()).toStrictEqual([""]);
    expect(result.current).toStrictEqual({ apps: [], bookmarks: [] });

    await machine.answers(0, [EDITOR]);

    expect(result.current).toStrictEqual({ apps: [EDITOR], bookmarks: [] });
  });

  it("asks nothing as the launcher opens, and asks again as it shuts", () => {
    const machine = host();
    const { rerender } = renderHook(
      ({ open }) => useOpeningApps(machine.searchApps, open),
      { initialProps: { open: false } },
    );

    rerender({ open: true });
    expect(machine.asked()).toStrictEqual([""]);

    rerender({ open: false });
    expect(machine.asked()).toStrictEqual(["", ""]);
  });

  it("keeps the latest answer when an older one arrives after it", async () => {
    const machine = host();
    const { rerender, result } = renderHook(
      ({ open }) => useOpeningApps(machine.searchApps, open),
      { initialProps: { open: false } },
    );
    rerender({ open: true });
    rerender({ open: false });

    await machine.answers(1, [PAINT]);
    await machine.answers(0, [EDITOR]);

    expect(result.current).toStrictEqual({ apps: [PAINT], bookmarks: [] });
  });

  it("keeps an answer that arrives after the launcher has opened", async () => {
    const machine = host();
    const { rerender, result } = renderHook(
      ({ open }) => useOpeningApps(machine.searchApps, open),
      { initialProps: { open: false } },
    );
    rerender({ open: true });

    await machine.answers(0, [EDITOR]);

    expect(result.current).toStrictEqual({ apps: [EDITOR], bookmarks: [] });
  });
});
