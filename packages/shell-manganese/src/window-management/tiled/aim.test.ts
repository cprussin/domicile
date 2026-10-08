import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { Aim, aimAt, cornerOf } from "./aim";

const LEFT = { frame: { height: 400, width: 500, x: 0, y: 0 }, id: "a" };
const RIGHT = { frame: { height: 400, width: 500, x: 500, y: 0 }, id: "b" };
/** A screen below the two with nothing tiled on it. */
const EMPTY = { area: { height: 400, width: 1000, x: 0, y: 500 }, name: "low" };
const TARGETS = { screens: [EMPTY], windows: [LEFT, RIGHT] };

describe("aimAt", () => {
  it("aims at the middle of the window under the pointer", () => {
    expect(aimAt(TARGETS, "a", 750, 200)).toEqual(
      Aim.Window("b", undefined, RIGHT.frame),
    );
  });

  it("aims at the edge of it the pointer is near, and half of it", () => {
    expect(aimAt(TARGETS, "a", 520, 200)).toEqual(
      Aim.Window("b", Direction.Left, {
        height: 400,
        width: 250,
        x: 500,
        y: 0,
      }),
    );
    expect(aimAt(TARGETS, "a", 750, 390)).toEqual(
      Aim.Window("b", Direction.Down, {
        height: 200,
        width: 500,
        x: 500,
        y: 200,
      }),
    );
  });

  it("aims at nothing over the window being dragged", () => {
    expect(aimAt(TARGETS, "a", 250, 200)).toBeUndefined();
  });

  it("aims at all of a screen with nothing tiled on it", () => {
    expect(aimAt(TARGETS, "a", 250, 600)).toEqual(
      Aim.Screen("low", EMPTY.area),
    );
  });

  it("aims at nothing where there is no window", () => {
    expect(aimAt(TARGETS, "a", 250, 450)).toBeUndefined();
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
