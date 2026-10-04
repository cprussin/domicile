import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import type { Placement } from "./placement";
import { LEAVING } from "./placement";
import type { Shown } from "./shown";
import { Layout } from "./tree/node";
import { useWindowMotion } from "./useWindowMotion";
import { ShellWindow } from "./window";
import type { WindowMotion } from "./window-motion";

const TERMINAL = ShellWindow.App("term", "kitty");
const EDITOR = ShellWindow.App("nvim", "nvim");

const placementOf = (id: string): Placement => ({
  bar: { height: 30, width: 1200, x: 0, y: 32 },
  behind: undefined,
  depth: 0,
  frame: { height: 800, width: 1200, x: 0, y: 32 },
  id,
  openTab: undefined,
  selected: false,
  surface: { height: 770, width: 1200, x: 0, y: 62 },
  tabbed: undefined,
});

/**
 * A desktop: the workspace on screen, the windows open, and which of them
 * that workspace is showing.
 */
const desktop = (
  current: string,
  windows: readonly ShellWindow[],
  showing: readonly ShellWindow[] = windows,
): Shown => ({
  activeId: showing[0]?.id,
  current,
  placements: showing.map(({ id }) => placementOf(id)),
  tabs: [],
  windows,
});

/** The one screen of most of these desks. */
const SCREEN = "screen";

const showing = (shown: Shown) =>
  renderHook((next: Shown) => useWindowMotion({ [SCREEN]: next }), {
    initialProps: shown,
  });

/** A desk of more than one screen, each showing its own workspace. */
const showingDesk = (desk: Readonly<Record<string, Shown>>) =>
  renderHook((next: Readonly<Record<string, Shown>>) => useWindowMotion(next), {
    initialProps: desk,
  });

const motionOf = (
  result: { current: ReturnType<typeof useWindowMotion> },
  id: string,
): WindowMotion | undefined =>
  result.current.drawn.find((drawn) => drawn.window.id === id)?.motion;

describe("useWindowMotion", () => {
  describe("a window that has opened", () => {
    it("grows in", () => {
      const { rerender, result } = showing(desktop("1", [TERMINAL]));

      act(() => {
        rerender(desktop("1", [TERMINAL, EDITOR]));
      });

      expect(motionOf(result, EDITOR.id)).toBe("opening");
    });

    it("is done when it says it has grown in", () => {
      const { rerender, result } = showing(desktop("1", [TERMINAL]));
      act(() => {
        rerender(desktop("1", [TERMINAL, EDITOR]));
      });

      act(() => {
        result.current.onPlayedOut(EDITOR.id, "opening", SCREEN);
      });

      expect(motionOf(result, EDITOR.id)).toBe("resting");
    });

    // REVEALING A WINDOW IS NOT OPENING ONE. A window behind a tab, or on a
    // workspace nobody is looking at, has been on the desktop the whole time —
    // and a desktop that played an arrival every time one came back into view
    // would announce ten openings on every workspace switch.
    it("is not what a window merely coming back into view does", () => {
      const { rerender, result } = showing(
        desktop("1", [TERMINAL, EDITOR], [TERMINAL]),
      );

      act(() => {
        rerender(desktop("1", [TERMINAL, EDITOR]));
      });

      expect(motionOf(result, EDITOR.id)).toBe("resting");
    });
  });

  describe("a window that has closed", () => {
    it("goes on being drawn, shrinking away from the box it had", () => {
      const { rerender, result } = showing(desktop("1", [TERMINAL, EDITOR]));

      act(() => {
        rerender(desktop("1", [TERMINAL]));
      });

      expect(
        result.current.drawn.find((drawn) => drawn.window.id === EDITOR.id),
      ).toMatchObject({
        motion: "closing",
        // At the box it had, raised over the windows moving into it.
        placement: { ...placementOf(EDITOR.id), depth: LEAVING },
      });
    });

    it("is let go of when it says it has gone", () => {
      const { rerender, result } = showing(desktop("1", [TERMINAL, EDITOR]));
      act(() => {
        rerender(desktop("1", [TERMINAL]));
      });

      act(() => {
        result.current.onPlayedOut(EDITOR.id, "closing", SCREEN);
      });

      expect(motionOf(result, EDITOR.id)).toBeUndefined();
    });
  });

  // A TAB CLOSING IS NOT A WINDOW SHRINKING AWAY. Its tab closes up in the
  // strip its neighbors close over, and when it was the one shown, its
  // contents fade to the tab that takes its place rather than shrinking off
  // it.
  describe("a tab that has closed", () => {
    const tabs = (windows: readonly ShellWindow[]): Shown => ({
      ...desktop("1", windows),
      placements: windows.map(({ id }) => ({
        ...placementOf(id),
        tabbed: Layout.Tabbed,
      })),
    });

    it("closes up rather than shrinking away", () => {
      const { rerender, result } = showing(tabs([TERMINAL, EDITOR]));

      act(() => {
        rerender(tabs([TERMINAL]));
      });

      expect(motionOf(result, EDITOR.id)).toBe("closing-tab");
    });

    it("is let go of when it says it has closed up", () => {
      const { rerender, result } = showing(tabs([TERMINAL, EDITOR]));
      act(() => {
        rerender(tabs([TERMINAL]));
      });

      act(() => {
        result.current.onPlayedOut(EDITOR.id, "closing-tab", SCREEN);
      });

      expect(motionOf(result, EDITOR.id)).toBeUndefined();
    });
  });

  describe("a float raised over another", () => {
    const floating = (on: string, under: string): Shown => ({
      ...desktop("1", [TERMINAL, EDITOR]),
      placements: [
        { ...placementOf(on), depth: 2 },
        { ...placementOf(under), depth: 1 },
      ],
    });

    it("shuffles over the one it covered, which shuffles under it", () => {
      const { rerender, result } = showing(floating(TERMINAL.id, EDITOR.id));

      act(() => {
        rerender(floating(EDITOR.id, TERMINAL.id));
      });

      expect(
        result.current.drawn.map(({ motion, restack, window }) => [
          window.id,
          motion,
          restack?.from,
          restack?.to,
        ]),
      ).toStrictEqual([
        [TERMINAL.id, "restacking", 2, 1],
        [EDITOR.id, "restacking", 1, 2],
      ]);
    });

    it("is done when it says it has shuffled", () => {
      const { rerender, result } = showing(floating(TERMINAL.id, EDITOR.id));
      act(() => {
        rerender(floating(EDITOR.id, TERMINAL.id));
      });

      act(() => {
        result.current.onPlayedOut(EDITOR.id, "restacking", SCREEN);
      });

      expect(motionOf(result, EDITOR.id)).toBe("resting");
      expect(motionOf(result, TERMINAL.id)).toBe("restacking");
    });

    // A NEW SHUFFLE IS A NEW ANIMATION. A browser restarts an animation only
    // when its name changes, so a window raised back while it is still
    // shuffling — or in the very frame it finished — has to be given the other
    // of the two, or it plays nothing and never says it has finished.
    it("starts over when raised back before it has finished", () => {
      const { rerender, result } = showing(floating(TERMINAL.id, EDITOR.id));
      act(() => {
        rerender(floating(EDITOR.id, TERMINAL.id));
      });

      act(() => {
        rerender(floating(TERMINAL.id, EDITOR.id));
      });

      expect(motionOf(result, TERMINAL.id)).toBe("restacking-again");
      expect(motionOf(result, EDITOR.id)).toBe("restacking-again");
    });

    it("starts over when raised back once it has finished", () => {
      const { rerender, result } = showing(floating(TERMINAL.id, EDITOR.id));
      act(() => {
        rerender(floating(EDITOR.id, TERMINAL.id));
      });
      act(() => {
        result.current.onPlayedOut(EDITOR.id, "restacking", SCREEN);
        result.current.onPlayedOut(TERMINAL.id, "restacking", SCREEN);
      });

      act(() => {
        rerender(floating(TERMINAL.id, EDITOR.id));
      });
      expect(motionOf(result, TERMINAL.id)).toBe("restacking-again");

      act(() => {
        result.current.onPlayedOut(TERMINAL.id, "restacking-again", SCREEN);
        result.current.onPlayedOut(EDITOR.id, "restacking-again", SCREEN);
      });
      act(() => {
        rerender(floating(EDITOR.id, TERMINAL.id));
      });
      expect(motionOf(result, TERMINAL.id)).toBe("restacking");
    });
  });

  describe("a tab switch", () => {
    const tabbed = (on: ShellWindow, off: ShellWindow): Shown => ({
      ...desktop("1", [TERMINAL, EDITOR]),
      placements: [
        placementOf(on.id),
        {
          ...placementOf(off.id),
          behind: placementOf(off.id).surface,
          surface: undefined,
        },
      ],
    });

    it("fades the window revealed in over the one it hides", () => {
      const { rerender, result } = showing(tabbed(TERMINAL, EDITOR));

      act(() => {
        rerender(tabbed(EDITOR, TERMINAL));
      });

      expect(motionOf(result, EDITOR.id)).toBe("revealing");
      expect(motionOf(result, TERMINAL.id)).toBe("concealing");
    });

    it("is done with each window when it says it has finished", () => {
      const { rerender, result } = showing(tabbed(TERMINAL, EDITOR));
      act(() => {
        rerender(tabbed(EDITOR, TERMINAL));
      });

      act(() => {
        result.current.onPlayedOut(EDITOR.id, "revealing", SCREEN);
        result.current.onPlayedOut(TERMINAL.id, "concealing", SCREEN);
      });

      expect(motionOf(result, EDITOR.id)).toBe("resting");
      expect(motionOf(result, TERMINAL.id)).toBe("resting");
    });

    // Each is given the other motion's name, so the browser starts it over.
    it("turns back when switched back before it has finished", () => {
      const { rerender, result } = showing(tabbed(TERMINAL, EDITOR));
      act(() => {
        rerender(tabbed(EDITOR, TERMINAL));
      });

      act(() => {
        rerender(tabbed(TERMINAL, EDITOR));
      });

      expect(motionOf(result, TERMINAL.id)).toBe("revealing");
      expect(motionOf(result, EDITOR.id)).toBe("concealing");
    });
  });

  describe("a workspace switch", () => {
    it("slides the workspace arriving in from the side it was on", () => {
      const { rerender, result } = showing(
        desktop("1", [TERMINAL, EDITOR], [TERMINAL]),
      );

      act(() => {
        rerender(desktop("2", [TERMINAL, EDITOR], [EDITOR]));
      });

      expect(motionOf(result, EDITOR.id)).toBe("arriving-from-end");
    });

    it("and slides the one being left off the other way", () => {
      const { rerender, result } = showing(
        desktop("1", [TERMINAL, EDITOR], [TERMINAL]),
      );

      act(() => {
        rerender(desktop("2", [TERMINAL, EDITOR], [EDITOR]));
      });

      expect(
        result.current.drawn.find((drawn) => drawn.window.id === TERMINAL.id),
      ).toMatchObject({
        motion: "leaving-to-start",
        placement: placementOf(TERMINAL.id),
      });
    });

    it("goes the other way when the switch goes back", () => {
      const { rerender, result } = showing(
        desktop("2", [TERMINAL, EDITOR], [EDITOR]),
      );

      act(() => {
        rerender(desktop("1", [TERMINAL, EDITOR], [TERMINAL]));
      });

      expect(motionOf(result, TERMINAL.id)).toBe("arriving-from-start");
    });

    // The bar of the window the keyboard was in goes on saying so while the
    // workspace it is on leaves.
    it("keeps the workspace being left saying where the keyboard was", () => {
      const { rerender, result } = showing(
        desktop("1", [TERMINAL, EDITOR], [TERMINAL]),
      );

      act(() => {
        rerender(desktop("2", [TERMINAL, EDITOR], [EDITOR]));
      });

      expect(
        result.current.drawn.find((drawn) => drawn.window.id === TERMINAL.id)
          ?.focused,
      ).toBe(true);
    });

    it("is over when one of the windows says it has finished sliding", () => {
      const { rerender, result } = showing(
        desktop("1", [TERMINAL, EDITOR], [TERMINAL]),
      );
      act(() => {
        rerender(desktop("2", [TERMINAL, EDITOR], [EDITOR]));
      });

      act(() => {
        result.current.onPlayedOut(EDITOR.id, "arriving-from-end", SCREEN);
      });

      expect(motionOf(result, EDITOR.id)).toBe("resting");
      expect(motionOf(result, TERMINAL.id)).toBe("resting");
    });
  });

  // ONE LIST FOR THE DESK. Every window is drawn once, on the screen showing
  // it, and a workspace switch is that screen's alone.
  describe("on a desk of two screens", () => {
    const WINDOWS = [TERMINAL, EDITOR];
    const desk = (left: string) => ({
      left: desktop(left, WINDOWS, left === "1" ? [TERMINAL] : []),
      right: desktop("2", WINDOWS, [EDITOR]),
    });

    it("draws each window once, on the screen showing it", () => {
      const { result } = showingDesk(desk("1"));

      expect(
        result.current.drawn.map(({ screen, window }) => [window.id, screen]),
      ).toStrictEqual([
        [TERMINAL.id, "left"],
        [EDITOR.id, "right"],
      ]);
    });

    it("slides only the screen whose workspace switched", () => {
      const { rerender, result } = showingDesk(desk("1"));

      act(() => {
        rerender(desk("3"));
      });

      expect(motionOf(result, TERMINAL.id)).toBe("leaving-to-start");
      expect(motionOf(result, EDITOR.id)).toBe("resting");
    });

    it("ends a switch on the screen whose window says it has finished", () => {
      const { rerender, result } = showingDesk(desk("1"));
      act(() => {
        rerender(desk("3"));
      });

      act(() => {
        result.current.onPlayedOut(TERMINAL.id, "leaving-to-start", "right");
      });
      expect(motionOf(result, TERMINAL.id)).toBe("leaving-to-start");

      act(() => {
        result.current.onPlayedOut(TERMINAL.id, "leaving-to-start", "left");
      });
      expect(motionOf(result, TERMINAL.id)).toBe("resting");
    });
  });
});
