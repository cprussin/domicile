import { describe, expect, it } from "bun:test";
import type {
  Bookmark,
  DesktopEntry,
  FoundAppsMessage,
} from "@domicile/chrome-sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { useFoundApps } from "./useFoundApps";

const EDITOR: DesktopEntry = {
  command: ["gedit"],
  comment: "",
  icon: undefined,
  id: "gedit.desktop",
  name: "Text Editor",
};

const MAIL: Bookmark = { name: "Mail", url: "https://mail.example.com" };

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
      bookmarks: readonly Bookmark[] = [],
    ): Promise<void> => {
      const asking = asked[at];
      if (asking === undefined) {
        throw new Error(`nothing was asked at ${at.toString()}`);
      } else {
        await act(async () => {
          asking.settle({ apps, bookmarks, query: asking.query });
          await Promise.resolve();
        });
      }
    },
    asked: () => asked.map(({ query }) => query),
    searchApps,
  };
};

describe("useFoundApps", () => {
  it("asks for what the box says, and has found nothing until it is answered", async () => {
    const machine = host();
    const { result } = renderHook(() => useFoundApps(machine.searchApps, "te"));

    expect(machine.asked()).toStrictEqual(["te"]);
    expect(result.current).toStrictEqual({ apps: [], bookmarks: [] });

    await machine.answers(0, [EDITOR], [MAIL]);

    expect(result.current).toStrictEqual({ apps: [EDITOR], bookmarks: [MAIL] });
  });

  it("keeps the answer to the box when a keystroke ago's arrives after it", async () => {
    const machine = host();
    const { rerender, result } = renderHook(
      ({ query }) => useFoundApps(machine.searchApps, query),
      { initialProps: { query: "t" } },
    );
    rerender({ query: "te" });

    await machine.answers(1, []);
    await machine.answers(0, [EDITOR], [MAIL]);

    expect(result.current).toStrictEqual({ apps: [], bookmarks: [] });
  });
});
