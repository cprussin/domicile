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

describe("floating windows", () => {
  const floating = (state: ShellState): string[] =>
    state.floats.map((float) => float.id);

  const twoTerminals = [
    ShellAction.AppAppeared("one", "One"),
    ShellAction.AppAppeared("two", "Two"),
  ] as const;

  it("takes a floated window off the stage and leaves it in the rail", () => {
    const state = after(...twoTerminals, ShellAction.WindowFloated("app:two"));
    expect(floating(state)).toStrictEqual(["app:two"]);
    // Still a window, so still a tab: the rail is how it is reached, and a
    // window with no tab and no stage is one the user has lost.
    expect(titles(state)).toStrictEqual(["One", "Two"]);
    // And the stage falls back rather than going blank, which would hide the
    // other windows because one of them was floated.
    expect(state.shownId).toBe("app:one");
    // The user is working in the window they just floated, wherever the
    // stage went.
    expect(state.activeId).toBe("app:two");
  });

  it("leaves the stage empty when the only window floats", () => {
    const state = after(
      ShellAction.AppAppeared("one", "One"),
      ShellAction.WindowFloated("app:one"),
    );
    expect(state.shownId).toBeUndefined();
    expect(state.activeId).toBe("app:one");
  });

  it("leaves the stage alone when a window that was not on it floats", () => {
    const state = after(...twoTerminals, ShellAction.WindowFloated("app:one"));
    expect(state.shownId).toBe("app:two");
  });

  it("cascades each float past the ones already out", () => {
    // Not a stack: a window that opened exactly on top of the last one looks
    // like the last one moved, and there is nothing to grab to find out.
    const state = after(
      ...twoTerminals,
      ShellAction.WindowFloated("app:one"),
      ShellAction.WindowFloated("app:two"),
    );
    const [first, second] = state.floats;
    expect(second?.x).toBeGreaterThan(first?.x ?? 0);
    expect(second?.y).toBeGreaterThan(first?.y ?? 0);
  });

  it("does not move a window that is floated twice", () => {
    // The user asking again for what they already have is the same window,
    // and re-cascading it would move one they had put somewhere on purpose.
    const once = after(...twoTerminals, ShellAction.WindowFloated("app:two"));
    expect(reduceShell(once, ShellAction.WindowFloated("app:two"))).toBe(once);
  });

  it("puts a window that stops floating back on the stage", () => {
    const state = after(
      ...twoTerminals,
      ShellAction.WindowFloated("app:two"),
      ShellAction.WindowTabbed("app:two"),
    );
    expect(floating(state)).toStrictEqual([]);
    expect(state.shownId).toBe("app:two");
  });

  it("raises a floating window to the front", () => {
    // The order is the stacking order, so the front is the end of the list.
    const state = after(
      ...twoTerminals,
      ShellAction.WindowFloated("app:one"),
      ShellAction.WindowFloated("app:two"),
      ShellAction.WindowRaised("app:one"),
    );
    expect(floating(state)).toStrictEqual(["app:two", "app:one"]);
    expect(state.activeId).toBe("app:one");
  });

  it("keeps a raised window's own box rather than re-cascading it", () => {
    const floated = after(
      ...twoTerminals,
      ShellAction.WindowFloated("app:two"),
    );
    const raised = reduceShell(floated, ShellAction.WindowRaised("app:two"));
    expect(raised.floats).toStrictEqual(floated.floats);
  });

  it("raises a floating window whose tab is picked, rather than staging it", () => {
    // Its tab is how it is reached; reaching a window that is on screen
    // already means bringing it to the front. Putting it back on the stage
    // would undo the float the user asked for.
    const state = after(
      ...twoTerminals,
      ShellAction.WindowFloated("app:two"),
      ShellAction.WindowSelected("app:two"),
    );
    expect(floating(state)).toStrictEqual(["app:two"]);
    expect(state.shownId).toBe("app:one");
    expect(state.activeId).toBe("app:two");
  });

  it("takes a floating window's box with it when it closes", () => {
    const state = after(
      ...twoTerminals,
      ShellAction.WindowFloated("app:two"),
      ShellAction.AppClosed("two"),
    );
    expect(floating(state)).toStrictEqual([]);
    expect(state.activeId).toBe("app:one");
  });

  it("moves to the float underneath when the front one closes", () => {
    const state = after(
      ...twoTerminals,
      ShellAction.WindowFloated("app:one"),
      ShellAction.WindowFloated("app:two"),
      ShellAction.AppClosed("two"),
    );
    expect(state.activeId).toBe("app:one");
  });

  it("refuses to float a window that is not open", () => {
    expect(() =>
      reduceShell(EMPTY_SHELL, ShellAction.WindowFloated("app:x")),
    ).toThrow();
  });

  it("refuses to tab or raise a window that is not floating", () => {
    const state = after(...twoTerminals);
    expect(() =>
      reduceShell(state, ShellAction.WindowTabbed("app:one")),
    ).toThrow();
    expect(() =>
      reduceShell(state, ShellAction.WindowRaised("app:one")),
    ).toThrow();
  });
});

describe("moving and resizing a floating window", () => {
  const boxOf = (state: ShellState, id: string) =>
    state.floats.find((float) => float.id === id);

  const oneFloating = [
    ShellAction.AppAppeared("one", "One"),
    ShellAction.AppAppeared("two", "Two"),
    ShellAction.WindowFloated("app:two"),
  ] as const;

  it("moves a floating window to where it was dragged", () => {
    const state = after(
      ...oneFloating,
      ShellAction.WindowMoved("app:two", 300, 200),
    );
    expect(boxOf(state, "app:two")).toMatchObject({ x: 300, y: 200 });
  });

  it("keeps a window's top-left corner on the stage", () => {
    // The two edges a window dragged past cannot be dragged back from: the
    // corner you would reach for is off the screen. The right and the bottom
    // are left alone, because a window most of the way off those still has
    // its top-left in reach.
    const state = after(
      ...oneFloating,
      ShellAction.WindowMoved("app:two", -400, -400),
    );
    expect(boxOf(state, "app:two")).toMatchObject({ x: 0, y: 0 });
  });

  it("resizes a floating window to where its corner was dragged", () => {
    const state = after(
      ...oneFloating,
      ShellAction.WindowResized("app:two", 800, 500),
    );
    expect(boxOf(state, "app:two")).toMatchObject({ height: 500, width: 800 });
  });

  it("will not resize a window smaller than what is left to grab", () => {
    // The corner a resize is driven from is inside the window, so a window
    // that can be made smaller than the grab is one that can be made
    // impossible to grab again.
    const state = after(
      ...oneFloating,
      ShellAction.WindowResized("app:two", 1, 1),
    );
    const box = boxOf(state, "app:two");
    expect(box?.width).toBeGreaterThan(1);
    expect(box?.height).toBeGreaterThan(1);
  });

  it("leaves every other window's box alone", () => {
    const floated = after(...oneFloating, ShellAction.WindowFloated("app:one"));
    const moved = reduceShell(
      floated,
      ShellAction.WindowMoved("app:two", 9, 9),
    );
    expect(boxOf(moved, "app:one")).toStrictEqual(boxOf(floated, "app:one"));
  });

  it("brings a window to the front when it is grabbed", () => {
    // The same thing clicking one does, which is what a grab is.
    const state = after(
      ...oneFloating,
      ShellAction.WindowFloated("app:one"),
      ShellAction.WindowGrabbed("app:two"),
    );
    expect(state.floats.at(-1)?.id).toBe("app:two");
    expect(state.draggingId).toBe("app:two");
  });

  it("lets go when the drag ends", () => {
    const state = after(
      ...oneFloating,
      ShellAction.WindowGrabbed("app:two"),
      ShellAction.WindowDropped(),
    );
    expect(state.draggingId).toBeUndefined();
  });

  it("lets go of a window that stops floating mid-drag", () => {
    // Whatever the pointer was doing, it was doing it to a window that is now
    // on the stage and has no box to drag.
    const state = after(
      ...oneFloating,
      ShellAction.WindowGrabbed("app:two"),
      ShellAction.WindowTabbed("app:two"),
    );
    expect(state.draggingId).toBeUndefined();
  });

  it("lets go of a window whose client goes away mid-drag", () => {
    const state = after(
      ...oneFloating,
      ShellAction.WindowGrabbed("app:two"),
      ShellAction.AppClosed("two"),
    );
    expect(state.draggingId).toBeUndefined();
  });

  it("refuses to move a window that is not floating", () => {
    const state = after(...oneFloating);
    expect(() =>
      reduceShell(state, ShellAction.WindowMoved("app:one", 1, 1)),
    ).toThrow();
  });
});
