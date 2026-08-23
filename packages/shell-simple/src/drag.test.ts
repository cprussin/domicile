import { describe, expect, it } from "bun:test";

import { Drag, dragTo } from "./drag";

const BOX = { height: 480, left: 100, top: 50, width: 640 };

describe("dragTo", () => {
  describe("moving", () => {
    it("carries the window the distance the pointer travelled", () => {
      expect(
        dragTo(Drag.Move(BOX, { x: 200, y: 100 }), { x: 260, y: 130 }),
      ).toStrictEqual({ height: 480, left: 160, top: 80, width: 640 });
    });

    it("moves the window rather than the corner the drag started at", () => {
      // The grab point is where the pointer went down, not the window's own
      // origin: a window grabbed near its bottom edge must not jump so that
      // edge lands under the pointer.
      const dragged = dragTo(Drag.Move(BOX, { x: 700, y: 500 }), {
        x: 700,
        y: 500,
      });
      expect(dragged).toStrictEqual(BOX);
    });
  });

  describe("resizing", () => {
    it("moves the bottom right corner and leaves the top left alone", () => {
      const dragged = dragTo(Drag.Resize(BOX, { x: 740, y: 530 }), {
        x: 780,
        y: 560,
      });
      expect(dragged).toStrictEqual({
        height: 510,
        left: 100,
        top: 50,
        width: 680,
      });
    });

    it("keeps a window big enough to grab again", () => {
      // Dragging the corner past the origin would otherwise give a window a
      // negative size — which the compositor cannot configure a client to, and
      // which leaves nothing on screen to drag back.
      const dragged = dragTo(Drag.Resize(BOX, { x: 740, y: 530 }), {
        x: 0,
        y: 0,
      });
      expect(dragged.width).toBeGreaterThan(0);
      expect(dragged.height).toBeGreaterThan(0);
    });
  });
});
