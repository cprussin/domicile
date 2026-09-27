import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { aimAt, cornerOf } from "./aim";

const LEFT = { frame: { height: 400, width: 500, x: 0, y: 0 }, id: "a" };
const RIGHT = { frame: { height: 400, width: 500, x: 500, y: 0 }, id: "b" };
const TARGETS = [LEFT, RIGHT];

describe("aimAt", () => {
  it("aims at the middle of the window under the pointer", () => {
    expect(aimAt(TARGETS, "a", 750, 200)).toEqual({
      edge: undefined,
      id: "b",
      rect: RIGHT.frame,
    });
  });

  it("aims at the edge of it the pointer is near, and half of it", () => {
    expect(aimAt(TARGETS, "a", 520, 200)).toEqual({
      edge: Direction.Left,
      id: "b",
      rect: { height: 400, width: 250, x: 500, y: 0 },
    });
    expect(aimAt(TARGETS, "a", 750, 390)).toEqual({
      edge: Direction.Down,
      id: "b",
      rect: { height: 200, width: 500, x: 500, y: 200 },
    });
  });

  it("aims at nothing over the window being dragged", () => {
    expect(aimAt(TARGETS, "a", 250, 200)).toBeUndefined();
  });

  it("aims at nothing where there is no window", () => {
    expect(aimAt(TARGETS, "a", 250, 600)).toBeUndefined();
  });
});

describe("cornerOf", () => {
  it("is the corner of the quarter the pointer took hold of", () => {
    expect(cornerOf(LEFT.frame, 100, 300)).toEqual({
      horizontal: Direction.Left,
      vertical: Direction.Down,
    });
    expect(cornerOf(LEFT.frame, 400, 100)).toEqual({
      horizontal: Direction.Right,
      vertical: Direction.Up,
    });
  });
});
