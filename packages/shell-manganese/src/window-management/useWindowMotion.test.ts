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
  selected: false,
  soleTab: false,
  strip: undefined,
  surface: { height: 770, width: 1200, x: 0, y: 62 },
  tabbed: undefined,
});

/** A desk with one screen: its workspace, open windows and shown windows. */
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

/** The screen most cases use. */
const SCREEN = "screen";

const showing = (shown: Shown) =>
  renderHook((next: Shown) => useWindowMotion({ [SCREEN]: next }), {
    initialProps: shown,
  });

/** A desk of several screens, each showing its own workspace. */
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

    // A window coming back into view (from behind a tab or another workspace)
    // must not play the opening animation, or every switch would look like many
    // windows opening.
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
        // At its old box, above the windows moving into it.
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

  // A new tab opens within its strip. Its contents fade in over the tab it
  // replaces instead of growing.
  describe("a tab that has opened", () => {
    const tabs = (windows: readonly ShellWindow[]): Shown => ({
      ...desktop("1", windows),
      placements: windows.map(({ id }) => ({
        ...placementOf(id),
        tabbed: Layout.Tabbed,
      })),
    });

    it("opens out rather than growing in", () => {
      const { rerender, result } = showing(tabs([TERMINAL]));

      act(() => {
        rerender(tabs([TERMINAL, EDITOR]));
      });

      expect(motionOf(result, EDITOR.id)).toBe("opening-tab");
    });

    it("is done when it says it has opened out", () => {
      const { rerender, result } = showing(tabs([TERMINAL]));
      act(() => {
        rerender(tabs([TERMINAL, EDITOR]));
      });

      act(() => {
        result.current.onPlayedOut(EDITOR.id, "opening-tab", SCREEN);
      });

      expect(motionOf(result, EDITOR.id)).toBe("resting");
    });
  });

  // A closing tab closes within its strip. If it was shown, its contents fade
  // to the replacing tab instead of shrinking.
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

    // Browsers restart an animation only when its name changes. A window raised
    // again while shuffling, or in the frame it finished, must get the other
    // name, or it plays nothing and never reports finishing.
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

    // Each gets the other name so the browser restarts it.
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

  describe("a tab uncovered by a close", () => {
    const shownOver = (hidden: ShellWindow): Shown => ({
      ...desktop("1", [TERMINAL, EDITOR]),
      placements: [
        placementOf(TERMINAL.id),
        {
          ...placementOf(hidden.id),
          behind: placementOf(hidden.id).surface,
          surface: undefined,
        },
      ],
    });

    // Its depth would otherwise ease up from the hidden tabs', letting one of
    // them show through the closing tab.
    it("holds its depth while the closed tab fades", () => {
      const { rerender, result } = showing(shownOver(EDITOR));

      act(() => {
        rerender(desktop("1", [EDITOR]));
      });

      expect(motionOf(result, EDITOR.id)).toBe("uncovering");
    });

    it("is done when it says it has finished", () => {
      const { rerender, result } = showing(shownOver(EDITOR));
      act(() => {
        rerender(desktop("1", [EDITOR]));
      });

      act(() => {
        result.current.onPlayedOut(EDITOR.id, "uncovering", SCREEN);
      });

      expect(motionOf(result, EDITOR.id)).toBe("resting");
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

    // The focused window's bar stays focused while its workspace leaves.
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

  // Each window is drawn once, on the screen showing it, and a workspace switch
  // affects only its screen.
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
