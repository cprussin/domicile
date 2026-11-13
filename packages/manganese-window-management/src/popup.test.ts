import { describe, expect, it } from "bun:test";

import type { Popup } from "./popup";
import { popupsOf } from "./popup";

/** A popup over `parent` at `position`. */
const over = (
  appId: string,
  parent: string,
  position: readonly [number, number],
): Popup => ({
  appId,
  cursor: "default",
  frame: 0,
  parent,
  position,
  size: [100, 50],
});

describe("a window's popups", () => {
  it("are at their offsets from its contents, with their cursors", () => {
    expect(
      popupsOf(
        [{ ...over("menu", "term", [12, 30]), cursor: "pointer" }],
        "term",
      ),
    ).toStrictEqual([
      {
        appId: "menu",
        cursor: "pointer",
        frame: 0,
        rect: { height: 50, width: 100, x: 12, y: 30 },
      },
    ]);
  });

  it("add up a submenu's offsets down to the window", () => {
    const popups = popupsOf(
      [over("menu", "term", [12, 30]), over("sub", "menu", [180, 20])],
      "term",
    );

    expect(popups.map(({ appId, rect }) => [appId, rect.x, rect.y])).toEqual([
      ["menu", 12, 30],
      ["sub", 192, 50],
    ]);
  });

  it("leave out other windows' popups", () => {
    expect(
      popupsOf(
        [over("menu", "other", [0, 0]), over("sub", "menu", [0, 0])],
        "term",
      ),
    ).toEqual([]);
  });
});
