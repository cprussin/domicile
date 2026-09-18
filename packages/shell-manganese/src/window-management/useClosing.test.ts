import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import type { Placement } from "./placement";
import { useClosing } from "./useClosing";
import { ShellWindow } from "./window";

const TERMINAL = ShellWindow.App("term", "kitty");
const EDITOR = ShellWindow.App("nvim", "nvim");

const placementOf = (id: string): Placement => ({
  bar: { height: 30, width: 1200, x: 0, y: 32 },
  depth: 0,
  id,
  surface: { height: 770, width: 1200, x: 0, y: 62 },
});

const desktop = (windows: readonly ShellWindow[]) => ({
  placements: windows.map((window) => placementOf(window.id)),
  windows,
});

const showing = (windows: readonly ShellWindow[]) =>
  renderHook(({ placements, windows: open }) => useClosing(open, placements), {
    initialProps: desktop(windows),
  });

describe("useClosing", () => {
  it("has nothing to play out while every window is still open", () => {
    expect(showing([TERMINAL]).result.current.closing).toStrictEqual([]);
  });

  it("holds a window that has closed, at the box it last had", () => {
    const { rerender, result } = showing([TERMINAL, EDITOR]);

    act(() => {
      rerender(desktop([EDITOR]));
    });

    expect(result.current.closing).toStrictEqual([
      { placement: placementOf(TERMINAL.id), title: "kitty" },
    ]);
  });

  // The window says when it has finished leaving, rather than a timer here
  // saying so: the animation is the stylesheet's and its length is a token,
  // and a duration written out twice is two things to keep in step.
  it("lets go of it once it says it has gone", () => {
    const { rerender, result } = showing([TERMINAL, EDITOR]);
    act(() => {
      rerender(desktop([EDITOR]));
    });

    act(() => {
      result.current.onGone(TERMINAL.id);
    });

    expect(result.current.closing).toStrictEqual([]);
  });

  it("goes on holding the ones that have not", () => {
    const { rerender, result } = showing([TERMINAL, EDITOR]);
    act(() => {
      rerender(desktop([]));
    });

    act(() => {
      result.current.onGone(TERMINAL.id);
    });

    expect(result.current.closing).toStrictEqual([
      { placement: placementOf(EDITOR.id), title: "nvim" },
    ]);
  });
});
