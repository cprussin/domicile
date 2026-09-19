import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import type { Placement } from "./placement";
import type { Shown } from "./shown";
import { useWindowMotion } from "./useWindowMotion";
import { ShellWindow } from "./window";
import type { WindowMotion } from "./window-motion";

const TERMINAL = ShellWindow.App("term", "kitty");
const EDITOR = ShellWindow.App("nvim", "nvim");

const placementOf = (id: string): Placement => ({
  bar: { height: 30, width: 1200, x: 0, y: 32 },
  depth: 0,
  frame: { height: 800, width: 1200, x: 0, y: 32 },
  id,
  surface: { height: 770, width: 1200, x: 0, y: 62 },
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

const showing = (shown: Shown) =>
  renderHook((next: Shown) => useWindowMotion(next), {
    initialProps: shown,
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
        result.current.onPlayedOut(EDITOR.id, "opening");
      });

      expect(motionOf(result, EDITOR.id)).toBe("resting");
    });

    // REVEALING A WINDOW IS NOT OPENING ONE. A window behind a tab, or under a
    // fullscreen one, or on a workspace nobody is looking at, has been on the
    // desktop the whole time — and a desktop that played an arrival every time
    // one came back into view would announce ten openings on every workspace
    // switch.
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
        placement: placementOf(EDITOR.id),
      });
    });

    it("is let go of when it says it has gone", () => {
      const { rerender, result } = showing(desktop("1", [TERMINAL, EDITOR]));
      act(() => {
        rerender(desktop("1", [TERMINAL]));
      });

      act(() => {
        result.current.onPlayedOut(EDITOR.id, "closing");
      });

      expect(motionOf(result, EDITOR.id)).toBeUndefined();
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
        result.current.onPlayedOut(EDITOR.id, "arriving-from-end");
      });

      expect(motionOf(result, EDITOR.id)).toBe("resting");
      expect(motionOf(result, TERMINAL.id)).toBe("resting");
    });
  });
});
