import { describe, expect, it } from "bun:test";
import { draggedArea, framePoint } from "./frame-point";

/** A 300x100 frame drawn 150x50 at (10, 20). */
const BOX = { height: 50, left: 10, top: 20, width: 150 };
const FRAME = { height: 100, width: 300 };

describe(framePoint, () => {
  it("finds the frame pixel under a point on the drawn frame", () => {
    expect(framePoint({ x: 85, y: 45 }, BOX, FRAME)).toEqual({ x: 150, y: 50 });
  });

  it("keeps a point off the drawn frame on its edge", () => {
    expect(framePoint({ x: 0, y: 500 }, BOX, FRAME)).toEqual({ x: 0, y: 99 });
  });
});

describe(draggedArea, () => {
  it("spans both corners, whichever way the drag went", () => {
    expect(draggedArea({ x: 5, y: 9 }, { x: 2, y: 3 })).toEqual({
      height: 7,
      width: 4,
      x: 2,
      y: 3,
    });
  });
});
