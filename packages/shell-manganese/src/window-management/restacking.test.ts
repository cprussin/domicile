import { describe, expect, it } from "bun:test";

import type { Placement } from "./placement";
import { LEAVING, TILED } from "./placement";
import type { Rect } from "./rect";
import { restacked, SHUFFLE } from "./restacking";
import type { Shown } from "./shown";

const LEFT: Rect = { height: 400, width: 600, x: 0, y: 0 };
// Right of `LEFT`, overlapping it.
const OVERLAPPING: Rect = { height: 400, width: 600, x: 300, y: 0 };
const APART: Rect = { height: 400, width: 600, x: 900, y: 0 };

const placed = (id: string, frame: Rect, depth: number): Placement => ({
  bar: { ...frame, height: 30 },
  behind: undefined,
  depth,
  frame,
  id,
  selected: false,
  soleTab: false,
  strip: undefined,
  surface: { ...frame, height: frame.height - 30, y: frame.y + 30 },
  tabbed: undefined,
});

const desktop = (placements: readonly Placement[], current = "1"): Shown => ({
  activeId: undefined,
  current,
  placements,
  scratchpad: [],
  tabs: [],
  windows: [],
});

describe("restacked", () => {
  // The two move apart, swap depth, and move back.
  it("parts the two windows that traded places, each away from the other", () => {
    expect(
      restacked(
        desktop([placed("a", LEFT, 1), placed("b", OVERLAPPING, 2)]),
        desktop([placed("a", LEFT, 2), placed("b", OVERLAPPING, 1)]),
      ),
    ).toStrictEqual([
      { away: { x: -SHUFFLE, y: 0 }, from: 1, id: "a", to: 2 },
      { away: { x: SHUFFLE, y: 0 }, from: 2, id: "b", to: 1 },
    ]);
  });

  // Windows that do not overlap show no change in order.
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

  // Fullscreen changes have their own animation. See `settlingStyles`.
  it("is only between floats", () => {
    expect(
      restacked(
        desktop([placed("a", LEFT, TILED), placed("b", OVERLAPPING, 1)]),
        desktop([placed("a", LEFT, LEAVING + 1), placed("b", OVERLAPPING, 1)]),
      ),
    ).toStrictEqual([]);
  });

  // A workspace switch slides the whole screen instead.
  it("is nothing across a workspace switch", () => {
    expect(
      restacked(
        desktop([placed("a", LEFT, 1), placed("b", OVERLAPPING, 2)], "1"),
        desktop([placed("a", LEFT, 2), placed("b", OVERLAPPING, 1)], "2"),
      ),
    ).toStrictEqual([]);
  });

  // Windows with the same center still part, horizontally.
  it("parts two windows with one middle along the row", () => {
    expect(
      restacked(
        desktop([placed("a", LEFT, 1), placed("b", LEFT, 2)]),
        desktop([placed("a", LEFT, 2), placed("b", LEFT, 1)]),
      ).map(({ away }) => away),
    ).toStrictEqual([
      { x: -SHUFFLE, y: 0 },
      { x: SHUFFLE, y: 0 },
    ]);
  });
});
