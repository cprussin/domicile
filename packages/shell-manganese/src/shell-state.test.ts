import { describe, expect, it } from "bun:test";

import type { ShellState } from "./shell-state";
import { EMPTY_SHELL, reduceShell, ShellAction } from "./shell-state";
import { WindowKind } from "./shell-window";

/** Apply actions in order, so a case reads as the history that produced it. */
const after = (...actions: readonly ShellAction[]): ShellState =>
  actions.reduce(reduceShell, EMPTY_SHELL);

const titles = (state: ShellState): string[] =>
  state.windows.map((window) => window.title);

describe("reduceShell", () => {
  describe("app windows", () => {
    it("opens a window for an app the host announces and shows it", () => {
      const state = after(ShellAction.AppAppeared("term", "Terminal"));
      expect(titles(state)).toStrictEqual(["Terminal"]);
      expect(state.shownId).toBe("app:term");
    });

    it("renames the tab when the client says what its window is called", () => {
      // A toplevel is announced when the client creates it, which is before
      // `set_title`, so the tab opens showing the app id and the name arrives
      // afterwards — and again every time it changes, which for a terminal is
      // every command it runs.
      expect(
        titles(
          after(
            ShellAction.AppAppeared("term", undefined),
            ShellAction.AppTitled("term", "~/domicile"),
          ),
        ),
      ).toStrictEqual(["~/domicile"]);
    });

    it("falls back to the app id for a client that named its window nothing", () => {
      expect(
        titles(
          after(
            ShellAction.AppAppeared("term", "Terminal"),
            ShellAction.AppTitled("term", undefined),
          ),
        ),
      ).toStrictEqual(["term"]);
    });

    it("falls back to the app id when the host sends no title", () => {
      expect(
        titles(after(ShellAction.AppAppeared("term", undefined))),
      ).toStrictEqual(["term"]);
    });

    it("ignores a second announcement of the same app", () => {
      const state = after(
        ShellAction.AppAppeared("term", "Terminal"),
        ShellAction.AppAppeared("term", "Terminal"),
      );
      expect(state.windows).toHaveLength(1);
    });

    it("drops the window when the app closes", () => {
      const state = after(
        ShellAction.AppAppeared("term", "Terminal"),
        ShellAction.AppClosed("term"),
      );
      expect(state.windows).toStrictEqual([]);
      expect(state.shownId).toBeUndefined();
    });

    it("ignores a close for an app that was never announced", () => {
      const state = after(
        ShellAction.AppAppeared("term", "Terminal"),
        ShellAction.AppClosed("ghost"),
      );
      expect(titles(state)).toStrictEqual(["Terminal"]);
    });
  });

  describe("browser windows", () => {
    it("opens a browser window titled with its site and shows it", () => {
      const state = after(ShellAction.BrowserOpened("https://example.com/a"));
      expect(titles(state)).toStrictEqual(["example.com"]);
      expect(state.shownId).toBe("browser:1");
    });

    it("numbers each browser window so ids stay unique", () => {
      const state = after(
        ShellAction.BrowserOpened("https://example.com"),
        ShellAction.BrowserOpened("https://example.com"),
      );
      expect(state.windows.map((window) => window.id)).toStrictEqual([
        "browser:1",
        "browser:2",
      ]);
    });

    it("retitles a window when its page navigates", () => {
      const state = after(
        ShellAction.BrowserOpened("https://example.com"),
        ShellAction.WindowRenamed("browser:1", "docs.example.com"),
      );
      expect(titles(state)).toStrictEqual(["docs.example.com"]);
    });

    it("keeps the src it opened with, so a retitle never reloads the page", () => {
      const state = after(
        ShellAction.BrowserOpened("https://example.com"),
        ShellAction.WindowRenamed("browser:1", "docs.example.com"),
      );
      expect(state.windows[0]).toMatchObject({
        kind: WindowKind.Browser,
        src: "https://example.com",
      });
    });
  });

  describe("the window on the stage", () => {
    it("hands the stage to the most recently opened survivor", () => {
      const state = after(
        ShellAction.AppAppeared("a", "A"),
        ShellAction.AppAppeared("b", "B"),
        ShellAction.BrowserOpened("https://example.com"),
        ShellAction.WindowClosed("browser:1"),
      );
      expect(state.shownId).toBe("app:b");
    });

    it("leaves the stage alone when a window that is not on it closes", () => {
      const state = after(
        ShellAction.AppAppeared("a", "A"),
        ShellAction.BrowserOpened("https://example.com"),
        ShellAction.AppClosed("a"),
      );
      expect(state.shownId).toBe("browser:1");
    });

    it("shows the window whose tab was picked", () => {
      const state = after(
        ShellAction.AppAppeared("a", "A"),
        ShellAction.AppAppeared("b", "B"),
        ShellAction.WindowSelected("app:a"),
      );
      expect(state.shownId).toBe("app:a");
    });

    it("throws when asked to show a window that is not open", () => {
      expect(() => {
        after(ShellAction.WindowSelected("app:ghost"));
      }).toThrow("no window app:ghost to show");
    });
  });

  describe("who has the keyboard", () => {
    it("follows the compositor rather than the stage", () => {
      // The stage says which window the shell is *showing*; this says which
      // one is being typed into. They agree while the shell is the only thing
      // moving focus, and part company the moment a click does — which is the
      // case this exists for, because the shell never hears about that click.
      const state = after(
        ShellAction.AppAppeared("term", "Terminal"),
        ShellAction.AppAppeared("editor", "Editor"),
        ShellAction.FocusChanged("term"),
      );

      expect(state.focusedId).toBe("app:term");
      expect(state.shownId).toBe("app:editor");
    });

    it("says the chrome has it when no app does", () => {
      // A focused client going away hands the keyboard back, and nothing the
      // shell did caused it. `undefined` is an answer a desktop draws — no
      // window is active — not an absence of one.
      const state = after(
        ShellAction.AppAppeared("term", "Terminal"),
        ShellAction.FocusChanged("term"),
        ShellAction.FocusChanged(undefined),
      );

      expect(state.focusedId).toBeUndefined();
    });

    it("does not re-render for focus that did not move", () => {
      // A chrome that has just connected is told the current holder, which is
      // usually what it already knew. Returning a fresh object there would
      // re-render every window for nothing.
      const focused = after(
        ShellAction.AppAppeared("term", "Terminal"),
        ShellAction.FocusChanged("term"),
      );

      expect(reduceShell(focused, ShellAction.FocusChanged("term"))).toBe(
        focused,
      );
    });
  });

  describe("reordering", () => {
    it("moves a window before another", () => {
      const state = after(
        ShellAction.AppAppeared("a", "A"),
        ShellAction.AppAppeared("b", "B"),
        ShellAction.AppAppeared("c", "C"),
        ShellAction.WindowsReordered("app:c", "app:a", "before"),
      );
      expect(titles(state)).toStrictEqual(["C", "A", "B"]);
    });

    it("moves a window after another", () => {
      const state = after(
        ShellAction.AppAppeared("a", "A"),
        ShellAction.AppAppeared("b", "B"),
        ShellAction.AppAppeared("c", "C"),
        ShellAction.WindowsReordered("app:a", "app:c", "after"),
      );
      expect(titles(state)).toStrictEqual(["B", "C", "A"]);
    });

    it("throws when the window it is dropped on is not open", () => {
      expect(() => {
        after(
          ShellAction.AppAppeared("a", "A"),
          ShellAction.WindowsReordered("app:a", "app:ghost", "after"),
        );
      }).toThrow("no window app:ghost to drop onto");
    });
  });
});
