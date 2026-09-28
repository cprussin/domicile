import { describe, expect, it } from "bun:test";

import type { Placement } from "./placement";
import { popupsOver } from "./popup";

/** A window's placement: its contents at `surface`, stacked at `depth`. */
const placed = (
  id: string,
  surface: Placement["surface"],
  depth = 0,
): Placement => ({
  bar: { height: 30, width: 0, x: 0, y: 0 },
  behind: undefined,
  depth,
  frame: { height: 0, width: 0, x: 0, y: 0 },
  id,
  surface,
  tabbed: undefined,
});

describe("where a popup goes", () => {
  it("is its offset from its window's contents, at the window's depth", () => {
    const [menu] = popupsOver(
      [
        {
          appId: "menu",
          parent: "term",
          position: [12, 30],
          size: [180, 240],
        },
      ],
      [placed("app:term", { height: 600, width: 800, x: 100, y: 50 }, 3)],
    );

    expect(menu).toStrictEqual({
      appId: "menu",
      depth: 3,
      rect: { height: 240, width: 180, x: 112, y: 80 },
    });
  });

  it("adds up a submenu's offsets down to the window", () => {
    const popups = popupsOver(
      [
        { appId: "menu", parent: "term", position: [12, 30], size: [180, 240] },
        { appId: "sub", parent: "menu", position: [180, 20], size: [100, 50] },
      ],
      [placed("app:term", { height: 600, width: 800, x: 100, y: 50 })],
    );

    expect(popups.map(({ appId, rect }) => [appId, rect.x, rect.y])).toEqual([
      ["menu", 112, 80],
      ["sub", 292, 100],
    ]);
  });

  it("is nowhere while its window is not on this screen", () => {
    // A window on another workspace, or on another page of the desk, has no
    // placement here — and a popup embedded where its window is not would take
    // the pixels of the one that is.
    expect(
      popupsOver(
        [{ appId: "menu", parent: "term", position: [0, 0], size: [1, 1] }],
        [placed("app:other", { height: 1, width: 1, x: 0, y: 0 })],
      ),
    ).toEqual([]);
  });
});
