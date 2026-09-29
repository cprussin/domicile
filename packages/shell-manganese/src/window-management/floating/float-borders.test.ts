import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { GrabCursor } from "../useGrabCursor";
import type { Float } from "./float";
import { floatBordersOf } from "./float-borders";

const AT: Float = {
  height: 400,
  id: "w1",
  scratchpad: false,
  width: 600,
  x: 100,
  y: 80,
};

describe("floatBordersOf", () => {
  it("rings the window with its four edges and four corners, a little inside it and a little out", () => {
    expect(floatBordersOf(AT)).toEqual([
      {
        cursor: GrabCursor.ResizeNwse,
        grip: { horizontal: Direction.Left, vertical: Direction.Up },
        rect: { height: 16, width: 16, x: 94, y: 74 },
      },
      {
        cursor: GrabCursor.ResizeNs,
        grip: { horizontal: undefined, vertical: Direction.Up },
        rect: { height: 10, width: 580, x: 110, y: 74 },
      },
      {
        cursor: GrabCursor.ResizeNesw,
        grip: { horizontal: Direction.Right, vertical: Direction.Up },
        rect: { height: 16, width: 16, x: 690, y: 74 },
      },
      {
        cursor: GrabCursor.ResizeEw,
        grip: { horizontal: Direction.Right, vertical: undefined },
        rect: { height: 380, width: 10, x: 696, y: 90 },
      },
      {
        cursor: GrabCursor.ResizeNwse,
        grip: { horizontal: Direction.Right, vertical: Direction.Down },
        rect: { height: 16, width: 16, x: 690, y: 470 },
      },
      {
        cursor: GrabCursor.ResizeNs,
        grip: { horizontal: undefined, vertical: Direction.Down },
        rect: { height: 10, width: 580, x: 110, y: 476 },
      },
      {
        cursor: GrabCursor.ResizeNesw,
        grip: { horizontal: Direction.Left, vertical: Direction.Down },
        rect: { height: 16, width: 16, x: 94, y: 470 },
      },
      {
        cursor: GrabCursor.ResizeEw,
        grip: { horizontal: Direction.Left, vertical: undefined },
        rect: { height: 380, width: 10, x: 94, y: 90 },
      },
    ]);
  });
});
