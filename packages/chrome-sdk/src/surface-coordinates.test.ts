import { describe, expect, it } from "bun:test";

import { elementToScreen } from "./element-transform";
import { rotate } from "./matrix";
import { surfaceLocal } from "./surface-coordinates";

describe("surfaceLocal", () => {
  it("scales element-local coords to surface pixels", () => {
    // A 200x200 element at (10, 20) showing a 100x100 surface.
    expect(
      surfaceLocal([1, 0, 0, 1, 10, 20], [200, 200], [100, 100], [110, 120]),
    ).toEqual({ x: 50, y: 50 });
  });

  it("falls back to element pixels when no frame has arrived yet", () => {
    expect(
      surfaceLocal([1, 0, 0, 1, 0, 0], [100, 100], [0, 0], [25, 40]),
    ).toEqual({ x: 25, y: 40 });
  });

  it("inverts a rotation instead of using the axis-aligned box", () => {
    // The demo shell rotates `.app`, which an element-box mapping would skew:
    // this 100x50 element's local (0, 0) is at screen (60, 20), not the box's
    // top-left corner (10, 20).
    const matrix = elementToScreen({
      box: { left: 10, top: 20 },
      linear: rotate(Math.PI / 2),
      origin: [50, 25],
      size: [100, 50],
    });
    const local = surfaceLocal(matrix, [100, 50], [100, 50], [60, 20]);
    expect(local?.x).toBeCloseTo(0);
    expect(local?.y).toBeCloseTo(0);
  });

  it("reports nothing when the element has no layout box", () => {
    expect(
      surfaceLocal([1, 0, 0, 1, 0, 0], [0, 0], [10, 10], [5, 5]),
    ).toBeUndefined();
  });

  it("reports nothing when the transform collapses the element", () => {
    expect(
      surfaceLocal([0, 0, 0, 0, 0, 0], [100, 100], [10, 10], [5, 5]),
    ).toBeUndefined();
  });
});
