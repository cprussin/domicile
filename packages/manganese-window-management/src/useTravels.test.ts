import { afterEach, describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import type { Placement } from "./placement";
import type { Rect } from "./rect";
import { WORKSPACE_CHIP } from "./travel";
import { useTravels } from "./useTravels";
import type { DrawnWindow } from "./useWindowMotion";
import { ShellWindow } from "./window";
import type { WindowMotion } from "./window-motion";

const EDITOR: Rect = { height: 600, width: 800, x: 0, y: 100 };
const DIALOG: Rect = { height: 200, width: 400, x: 600, y: 300 };

const placed = (id: string, frame: Rect): Placement => ({
  bar: { ...frame, height: 30 },
  bare: false,
  behind: undefined,
  depth: 1,
  frame,
  id,
  selected: false,
  soleTab: false,
  strip: undefined,
  surface: { ...frame, height: frame.height - 30, y: frame.y + 30 },
  tabbed: undefined,
});

const drawn = (
  window: ReturnType<typeof ShellWindow.App>,
  frame: Rect | undefined,
  motion: WindowMotion,
  screen = "left",
): DrawnWindow => ({
  crossing: false,
  focused: false,
  motion,
  placement: frame === undefined ? undefined : placed(window.id, frame),
  restack: undefined,
  revealedFrom: undefined,
  rewound: 0,
  screen,
  shownRewound: 0,
  window,
});

const editor = ShellWindow.App("editor", "Editor");
const dialog = ShellWindow.App("save", "Save", "editor");

const NOWHERE = () => undefined;

/** Puts workspace `name`'s chip in the bar at `box`. */
const chipAt = (name: string, box: Rect): void => {
  const chip = document.createElement("button");
  chip.setAttribute(WORKSPACE_CHIP, name);
  chip.getBoundingClientRect = () => DOMRect.fromRect(box);
  document.body.append(chip);
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("useTravels", () => {
  describe("a dialog opening", () => {
    it("grows out of the middle of the window it is for", () => {
      const { result } = renderHook(() =>
        useTravels(
          [drawn(editor, EDITOR, "resting"), drawn(dialog, DIALOG, "opening")],
          NOWHERE,
        ),
      );

      expect(result.current.get(dialog.id)).toStrictEqual({
        scale: undefined,
        x: -400,
        y: 0,
      });
    });

    it("grows in place while that window is not drawn", () => {
      const { result } = renderHook(() =>
        useTravels([drawn(dialog, DIALOG, "opening")], NOWHERE),
      );

      expect(result.current.get(dialog.id)).toBeUndefined();
    });

    it("grows in place from a window on another screen", () => {
      const { result } = renderHook(() =>
        useTravels(
          [
            drawn(editor, EDITOR, "resting", "right"),
            drawn(dialog, DIALOG, "opening"),
          ],
          NOWHERE,
        ),
      );

      expect(result.current.get(dialog.id)).toBeUndefined();
    });

    it("travels nowhere once it has opened", () => {
      const { result } = renderHook(() =>
        useTravels(
          [drawn(editor, EDITOR, "resting"), drawn(dialog, DIALOG, "resting")],
          NOWHERE,
        ),
      );

      expect(result.current.size).toBe(0);
    });
  });

  describe("a window sent to another workspace", () => {
    it("flies into the workspace's chip", () => {
      chipAt("2", { height: 24, width: 32, x: 384, y: 0 });
      const { result } = renderHook(() =>
        useTravels([drawn(editor, EDITOR, "sending")], () => "2"),
      );

      expect(result.current.get(editor.id)).toStrictEqual({
        scale: 0.04,
        x: 0,
        y: -388,
      });
    });

    it("flies into its chip as a tab", () => {
      chipAt("2", { height: 24, width: 32, x: 384, y: 0 });
      const { result } = renderHook(() =>
        useTravels([drawn(editor, EDITOR, "sending-tab")], () => "2"),
      );

      expect(result.current.get(editor.id)?.scale).toBe(0.04);
    });

    it("shrinks in place when no bar shows the workspace", () => {
      chipAt("3", { height: 24, width: 32, x: 384, y: 0 });
      const { result } = renderHook(() =>
        useTravels([drawn(editor, EDITOR, "sending")], () => "2"),
      );

      expect(result.current.get(editor.id)).toBeUndefined();
    });

    // The chip may move as the bar makes room for it; the window keeps the
    // path it set out on.
    it("keeps flying where it set out for", () => {
      chipAt("2", { height: 24, width: 32, x: 384, y: 0 });
      const { rerender, result } = renderHook(
        ({ windows }) => useTravels(windows, () => "2"),
        { initialProps: { windows: [drawn(editor, EDITOR, "sending")] } },
      );
      const first = result.current.get(editor.id);
      document.body.replaceChildren();
      chipAt("2", { height: 24, width: 32, x: 0, y: 0 });

      rerender({ windows: [drawn(editor, EDITOR, "sending")] });

      expect(result.current.get(editor.id)).toBe(first);
    });

    it("travels nowhere once it has gone", () => {
      chipAt("2", { height: 24, width: 32, x: 384, y: 0 });
      const { rerender, result } = renderHook(
        ({ windows }) => useTravels(windows, () => "2"),
        { initialProps: { windows: [drawn(editor, EDITOR, "sending")] } },
      );

      rerender({ windows: [] });

      expect(result.current.size).toBe(0);
    });
  });
});
