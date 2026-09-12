import { describe, expect, it } from "bun:test";
import { appWindowId, WindowKind } from "./window";
import type { WindowState } from "./window-state";
import { NO_WINDOWS, reduceWindows, WindowAction } from "./window-state";

/** Apply actions in order, so a case reads as the history that produced it. */
const after = (...actions: readonly WindowAction[]): WindowState =>
  actions.reduce(reduceWindows, NO_WINDOWS);

const titles = (state: WindowState): string[] =>
  state.windows.map((window) => window.title);

/** The window the shell holds for a client, with the client's own facts on it. */
const appOf = (state: WindowState, appId: string) => {
  const window = state.windows.find((open) => open.id === appWindowId(appId));
  return window?.kind === WindowKind.App ? window : undefined;
};

describe("reduceWindows", () => {
  describe("app windows", () => {
    it("opens a window for an app the host announces and shows it", () => {
      const state = after(WindowAction.AppAppeared("term", "Terminal"));
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
            WindowAction.AppAppeared("term", undefined),
            WindowAction.AppTitled("term", "~/domicile"),
          ),
        ),
      ).toStrictEqual(["~/domicile"]);
    });

    it("falls back to the app id for a client that named its window nothing", () => {
      expect(
        titles(
          after(
            WindowAction.AppAppeared("term", "Terminal"),
            WindowAction.AppTitled("term", undefined),
          ),
        ),
      ).toStrictEqual(["term"]);
    });

    it("falls back to the app id when the host sends no title", () => {
      expect(
        titles(after(WindowAction.AppAppeared("term", undefined))),
      ).toStrictEqual(["term"]);
    });

    it("ignores a second announcement of the same app", () => {
      const state = after(
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppAppeared("term", "Terminal"),
      );
      expect(state.windows).toHaveLength(1);
    });

    it("drops the window when the app closes", () => {
      const state = after(
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppClosed("term"),
      );
      expect(state.windows).toStrictEqual([]);
      expect(state.shownId).toBeUndefined();
    });

    it("ignores a close for an app that was never announced", () => {
      const state = after(
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppClosed("ghost"),
      );
      expect(titles(state)).toStrictEqual(["Terminal"]);
    });

    it("records the cursor the client asked for", () => {
      const state = after(
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppCursorChanged("term", "text"),
      );
      expect(appOf(state, "term")?.cursor).toBe("text");
    });

    it("says nothing about a client it has no window for", () => {
      // The host drains its events for a window whose close has already been
      // reduced here, so a cursor can name one that is gone.
      expect(() =>
        after(WindowAction.AppCursorChanged("ghost", "text")),
      ).not.toThrow();
    });
  });

  describe("browser windows", () => {
    it("opens a browser window titled with its site and shows it", () => {
      const state = after(WindowAction.BrowserOpened("https://example.com/a"));
      expect(titles(state)).toStrictEqual(["example.com"]);
      expect(state.shownId).toBe("browser:1");
    });

    it("numbers each browser window so ids stay unique", () => {
      const state = after(
        WindowAction.BrowserOpened("https://example.com"),
        WindowAction.BrowserOpened("https://example.com"),
      );
      expect(state.windows.map((window) => window.id)).toStrictEqual([
        "browser:1",
        "browser:2",
      ]);
    });

    it("retitles a window when its page navigates", () => {
      const state = after(
        WindowAction.BrowserOpened("https://example.com"),
        WindowAction.WindowRenamed("browser:1", "docs.example.com"),
      );
      expect(titles(state)).toStrictEqual(["docs.example.com"]);
    });

    it("keeps the src it opened with, so a retitle never reloads the page", () => {
      const state = after(
        WindowAction.BrowserOpened("https://example.com"),
        WindowAction.WindowRenamed("browser:1", "docs.example.com"),
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
        WindowAction.AppAppeared("a", "A"),
        WindowAction.AppAppeared("b", "B"),
        WindowAction.BrowserOpened("https://example.com"),
        WindowAction.WindowClosed("browser:1"),
      );
      expect(state.shownId).toBe("app:b");
    });

    it("leaves the stage alone when a window that is not on it closes", () => {
      const state = after(
        WindowAction.AppAppeared("a", "A"),
        WindowAction.BrowserOpened("https://example.com"),
        WindowAction.AppClosed("a"),
      );
      expect(state.shownId).toBe("browser:1");
    });

    it("shows the window whose tab was picked", () => {
      const state = after(
        WindowAction.AppAppeared("a", "A"),
        WindowAction.AppAppeared("b", "B"),
        WindowAction.WindowSelected("app:a"),
      );
      expect(state.shownId).toBe("app:a");
    });

    it("throws when asked to show a window that is not open", () => {
      expect(() => {
        after(WindowAction.WindowSelected("app:ghost"));
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
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppAppeared("editor", "Editor"),
        WindowAction.FocusChanged("term"),
      );

      expect(state.focusedId).toBe("app:term");
      expect(state.shownId).toBe("app:editor");
    });

    it("says the chrome has it when no app does", () => {
      // A focused client going away hands the keyboard back, and nothing the
      // shell did caused it. `undefined` is an answer a desktop draws — no
      // window is active — not an absence of one.
      const state = after(
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.FocusChanged("term"),
        WindowAction.FocusChanged(undefined),
      );

      expect(state.focusedId).toBeUndefined();
    });

    it("gives the keyboard to a client that asked for it", () => {
      // Manganese's focus policy, and the whole of it: a client that asks is
      // reached exactly as if the user had picked its tab. It is one line
      // because it is a decision rather than a mechanism — a shell that would
      // rather refuse a window the user is not in writes a different one here,
      // and nothing below the shell has an opinion either way.
      const state = after(
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppAppeared("editor", "Editor"),
        WindowAction.WindowSelected("app:editor"),
        WindowAction.FocusRequested("term"),
      );

      expect(state.activeId).toBe("app:term");
      expect(state.shownId).toBe("app:term");
    });

    it("ignores a request from a window it does not have", () => {
      // The host gates these on a client it knows about, and the shell's own
      // list is the narrower one: a window whose `app_closed` has been reduced
      // but whose request was already in flight names nothing this can reach.
      const open = after(WindowAction.AppAppeared("term", "Terminal"));

      expect(reduceWindows(open, WindowAction.FocusRequested("ghost"))).toBe(
        open,
      );
    });

    it("keeps the window it moved to when the compositor hands the keyboard back", () => {
      // A client that dies takes the keyboard with it, and the compositor
      // gives it to the chrome — which it has to, because a keyboard pointed
      // at a surface that is gone is a desktop that has stopped listening. But
      // that is a fallback and not a decision: the shell has already named the
      // window the user is now in, and the `focus_changed` that follows says
      // where the seat *is* rather than where it belongs.
      //
      // Reduced the other way round, the shell would answer every close by
      // marking no window active and then moving the keyboard back a render
      // later — a flicker on the rail, and a keystroke in between going
      // nowhere.
      const state = after(
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppAppeared("editor", "Editor"),
        WindowAction.FocusChanged("editor"),
        WindowAction.AppClosed("editor"),
        WindowAction.FocusChanged(undefined),
      );

      expect(state.activeId).toBe("app:term");
      // And it is honest about where the seat actually is meanwhile: what
      // moves it is the window that is now active asking for it.
      expect(state.focusedId).toBeUndefined();
    });

    it("does not re-render for focus that did not move", () => {
      // A chrome that has just connected is told the current holder, which is
      // usually what it already knew. Returning a fresh object there would
      // re-render every window for nothing.
      const focused = after(
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.FocusChanged("term"),
      );

      expect(reduceWindows(focused, WindowAction.FocusChanged("term"))).toBe(
        focused,
      );
    });
  });

  describe("reordering", () => {
    it("moves a window before another", () => {
      const state = after(
        WindowAction.AppAppeared("a", "A"),
        WindowAction.AppAppeared("b", "B"),
        WindowAction.AppAppeared("c", "C"),
        WindowAction.WindowsReordered("app:c", "app:a", "before"),
      );
      expect(titles(state)).toStrictEqual(["C", "A", "B"]);
    });

    it("moves a window after another", () => {
      const state = after(
        WindowAction.AppAppeared("a", "A"),
        WindowAction.AppAppeared("b", "B"),
        WindowAction.AppAppeared("c", "C"),
        WindowAction.WindowsReordered("app:a", "app:c", "after"),
      );
      expect(titles(state)).toStrictEqual(["B", "C", "A"]);
    });

    it("throws when the window it is dropped on is not open", () => {
      expect(() => {
        after(
          WindowAction.AppAppeared("a", "A"),
          WindowAction.WindowsReordered("app:a", "app:ghost", "after"),
        );
      }).toThrow("no window app:ghost to drop onto");
    });
  });
});

describe("floating windows", () => {
  const floating = (state: WindowState): string[] =>
    state.floats.map((float) => float.id);

  const twoTerminals = [
    WindowAction.AppAppeared("one", "One"),
    WindowAction.AppAppeared("two", "Two"),
  ] as const;

  it("takes a floated window off the stage and leaves it in the rail", () => {
    const state = after(...twoTerminals, WindowAction.WindowFloated("app:two"));
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
      WindowAction.AppAppeared("one", "One"),
      WindowAction.WindowFloated("app:one"),
    );
    expect(state.shownId).toBeUndefined();
    expect(state.activeId).toBe("app:one");
  });

  it("leaves the stage alone when a window that was not on it floats", () => {
    const state = after(...twoTerminals, WindowAction.WindowFloated("app:one"));
    expect(state.shownId).toBe("app:two");
  });

  it("cascades each float past the ones already out", () => {
    // Not a stack: a window that opened exactly on top of the last one looks
    // like the last one moved, and there is nothing to grab to find out.
    const state = after(
      ...twoTerminals,
      WindowAction.WindowFloated("app:one"),
      WindowAction.WindowFloated("app:two"),
    );
    const [first, second] = state.floats;
    expect(second?.x).toBeGreaterThan(first?.x ?? 0);
    expect(second?.y).toBeGreaterThan(first?.y ?? 0);
  });

  it("does not move a window that is floated twice", () => {
    // The user asking again for what they already have is the same window,
    // and re-cascading it would move one they had put somewhere on purpose.
    const once = after(...twoTerminals, WindowAction.WindowFloated("app:two"));
    expect(reduceWindows(once, WindowAction.WindowFloated("app:two"))).toBe(
      once,
    );
  });

  it("puts a window that stops floating back on the stage", () => {
    const state = after(
      ...twoTerminals,
      WindowAction.WindowFloated("app:two"),
      WindowAction.WindowTabbed("app:two"),
    );
    expect(floating(state)).toStrictEqual([]);
    expect(state.shownId).toBe("app:two");
  });

  it("raises a floating window to the front", () => {
    // The order is the stacking order, so the front is the end of the list.
    const state = after(
      ...twoTerminals,
      WindowAction.WindowFloated("app:one"),
      WindowAction.WindowFloated("app:two"),
      WindowAction.WindowRaised("app:one"),
    );
    expect(floating(state)).toStrictEqual(["app:two", "app:one"]);
    expect(state.activeId).toBe("app:one");
  });

  it("keeps a raised window's own box rather than re-cascading it", () => {
    const floated = after(
      ...twoTerminals,
      WindowAction.WindowFloated("app:two"),
    );
    const raised = reduceWindows(floated, WindowAction.WindowRaised("app:two"));
    expect(raised.floats).toStrictEqual(floated.floats);
  });

  it("raises a floating window whose tab is picked, rather than staging it", () => {
    // Its tab is how it is reached; reaching a window that is on screen
    // already means bringing it to the front. Putting it back on the stage
    // would undo the float the user asked for.
    const state = after(
      ...twoTerminals,
      WindowAction.WindowFloated("app:two"),
      WindowAction.WindowSelected("app:two"),
    );
    expect(floating(state)).toStrictEqual(["app:two"]);
    expect(state.shownId).toBe("app:one");
    expect(state.activeId).toBe("app:two");
  });

  it("takes a floating window's box with it when it closes", () => {
    const state = after(
      ...twoTerminals,
      WindowAction.WindowFloated("app:two"),
      WindowAction.AppClosed("two"),
    );
    expect(floating(state)).toStrictEqual([]);
    expect(state.activeId).toBe("app:one");
  });

  it("moves to the float underneath when the front one closes", () => {
    const state = after(
      ...twoTerminals,
      WindowAction.WindowFloated("app:one"),
      WindowAction.WindowFloated("app:two"),
      WindowAction.AppClosed("two"),
    );
    expect(state.activeId).toBe("app:one");
  });

  it("refuses to float a window that is not open", () => {
    expect(() =>
      reduceWindows(NO_WINDOWS, WindowAction.WindowFloated("app:x")),
    ).toThrow();
  });

  it("refuses to tab or raise a window that is not floating", () => {
    const state = after(...twoTerminals);
    expect(() =>
      reduceWindows(state, WindowAction.WindowTabbed("app:one")),
    ).toThrow();
    expect(() =>
      reduceWindows(state, WindowAction.WindowRaised("app:one")),
    ).toThrow();
  });
});

describe("moving and resizing a floating window", () => {
  const boxOf = (state: WindowState, id: string) =>
    state.floats.find((float) => float.id === id);

  const oneFloating = [
    WindowAction.AppAppeared("one", "One"),
    WindowAction.AppAppeared("two", "Two"),
    WindowAction.WindowFloated("app:two"),
  ] as const;

  it("moves a floating window to where it was dragged", () => {
    const state = after(
      ...oneFloating,
      WindowAction.WindowMoved("app:two", 300, 200),
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
      WindowAction.WindowMoved("app:two", -400, -400),
    );
    expect(boxOf(state, "app:two")).toMatchObject({ x: 0, y: 0 });
  });

  it("resizes a floating window to where its corner was dragged", () => {
    const state = after(
      ...oneFloating,
      WindowAction.WindowResized("app:two", 800, 500),
    );
    expect(boxOf(state, "app:two")).toMatchObject({ height: 500, width: 800 });
  });

  it("will not resize a window smaller than what is left to grab", () => {
    // The corner a resize is driven from is inside the window, so a window
    // that can be made smaller than the grab is one that can be made
    // impossible to grab again.
    const state = after(
      ...oneFloating,
      WindowAction.WindowResized("app:two", 1, 1),
    );
    const box = boxOf(state, "app:two");
    expect(box?.width).toBeGreaterThan(1);
    expect(box?.height).toBeGreaterThan(1);
  });

  it("leaves every other window's box alone", () => {
    const floated = after(
      ...oneFloating,
      WindowAction.WindowFloated("app:one"),
    );
    const moved = reduceWindows(
      floated,
      WindowAction.WindowMoved("app:two", 9, 9),
    );
    expect(boxOf(moved, "app:one")).toStrictEqual(boxOf(floated, "app:one"));
  });

  it("brings a window to the front when it is grabbed", () => {
    // The same thing clicking one does, which is what a grab is.
    const state = after(
      ...oneFloating,
      WindowAction.WindowFloated("app:one"),
      WindowAction.WindowGrabbed("app:two"),
    );
    expect(state.floats.at(-1)?.id).toBe("app:two");
    expect(state.draggingId).toBe("app:two");
  });

  it("lets go when the drag ends", () => {
    const state = after(
      ...oneFloating,
      WindowAction.WindowGrabbed("app:two"),
      WindowAction.WindowDropped(),
    );
    expect(state.draggingId).toBeUndefined();
  });

  it("lets go of a window that stops floating mid-drag", () => {
    // Whatever the pointer was doing, it was doing it to a window that is now
    // on the stage and has no box to drag.
    const state = after(
      ...oneFloating,
      WindowAction.WindowGrabbed("app:two"),
      WindowAction.WindowTabbed("app:two"),
    );
    expect(state.draggingId).toBeUndefined();
  });

  it("lets go of a window whose client goes away mid-drag", () => {
    const state = after(
      ...oneFloating,
      WindowAction.WindowGrabbed("app:two"),
      WindowAction.AppClosed("two"),
    );
    expect(state.draggingId).toBeUndefined();
  });

  it("refuses to move a window that is not floating", () => {
    const state = after(...oneFloating);
    expect(() =>
      reduceWindows(state, WindowAction.WindowMoved("app:one", 1, 1)),
    ).toThrow();
  });
});
