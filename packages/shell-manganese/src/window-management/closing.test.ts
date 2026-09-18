import { describe, expect, it } from "bun:test";

import { departed } from "./closing";
import type { Placement } from "./placement";
import { ShellWindow } from "./window";

const TERMINAL = ShellWindow.App("term", "kitty");
const EDITOR = ShellWindow.App("nvim", "nvim");

const placementOf = (id: string): Placement => ({
  bar: { height: 30, width: 1200, x: 0, y: 32 },
  depth: 0,
  id,
  surface: { height: 770, width: 1200, x: 0, y: 62 },
});

describe("departed", () => {
  it("keeps a window that is no longer open, with the box it last had", () => {
    expect(
      departed([TERMINAL, EDITOR], [EDITOR], [placementOf(TERMINAL.id)]),
    ).toStrictEqual([{ placement: placementOf(TERMINAL.id), title: "kitty" }]);
  });

  it("says nothing about the windows that are still open", () => {
    expect(
      departed([TERMINAL], [TERMINAL], [placementOf(TERMINAL.id)]),
    ).toStrictEqual([]);
  });

  // A window closed on a workspace nobody is looking at has no rectangle to
  // play out at, and the one it had belongs to whatever is on screen now.
  it("leaves out a window that was not on screen when it closed", () => {
    expect(departed([TERMINAL], [], [])).toStrictEqual([]);
  });
});
