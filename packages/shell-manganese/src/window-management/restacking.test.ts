import { describe, expect, it } from "bun:test";

import type { Placement } from "./placement";
import { LEAVING, TILED } from "./placement";
import type { Rect } from "./rect";
import { restacked } from "./restacking";
import type { Shown } from "./shown";

const LEFT: Rect = { height: 400, width: 600, x: 0, y: 0 };
const OVERLAPPING: Rect = { height: 400, width: 600, x: 300, y: 200 };
const APART: Rect = { height: 400, width: 600, x: 900, y: 0 };

const placed = (id: string, frame: Rect, depth: number): Placement => ({
  bar: { ...frame, height: 30 },
  depth,
  frame,
  id,
  surface: { ...frame, height: frame.height - 30, y: frame.y + 30 },
});

const desktop = (placements: readonly Placement[], current = "1"): Shown => ({
  activeId: undefined,
  current,
  placements,
  tabs: [],
  windows: [],
});

describe("restacked", () => {
  it("surfaces the window raised over one it overlaps, and sinks that one", () => {
    expect(
      restacked(
        desktop([placed("a", LEFT, 1), placed("b", OVERLAPPING, 2)]),
        desktop([placed("a", LEFT, 2), placed("b", OVERLAPPING, 1)]),
      ),
    ).toStrictEqual([
      { id: "a", motion: "surfacing" },
      { id: "b", motion: "sinking" },
    ]);
  });

  // NOTHING TO SEE. Two windows side by side cover nothing of each other, so
  // which is over which is not something the screen shows.
  it("leaves windows that do not overlap alone", () => {
    expect(
      restacked(
        desktop([placed("a", LEFT, 1), placed("b", APART, 2)]),
        desktop([placed("a", LEFT, 2), placed("b", APART, 1)]),
      ),
    ).toStrictEqual([]);
  });

  it("leaves windows whose order did not change alone", () => {
    expect(
      restacked(
        desktop([placed("a", LEFT, 1), placed("b", OVERLAPPING, 2)]),
        desktop([placed("a", LEFT, 1), placed("b", OVERLAPPING, 3)]),
      ),
    ).toStrictEqual([]);
  });

  // A WINDOW TAKING THE SCREEN OR GIVING IT BACK is already a movement of its
  // own — see `settlingStyles` — and a pop on top of it is two at once.
  it("is only between floats", () => {
    expect(
      restacked(
        desktop([placed("a", LEFT, TILED), placed("b", OVERLAPPING, 1)]),
        desktop([placed("a", LEFT, LEAVING + 1), placed("b", OVERLAPPING, 1)]),
      ),
    ).toStrictEqual([]);
  });

  // The whole screenful changes on a switch, and it slides rather than pops.
  it("is nothing across a workspace switch", () => {
    expect(
      restacked(
        desktop([placed("a", LEFT, 1), placed("b", OVERLAPPING, 2)], "1"),
        desktop([placed("a", LEFT, 2), placed("b", OVERLAPPING, 1)], "2"),
      ),
    ).toStrictEqual([]);
  });
});
