import { describe, expect, it } from "bun:test";

import { elementToScreen } from "./element-transform";
import { rotate } from "./matrix";

describe("elementToScreen", () => {
  it("is a plain translation to the box for an untransformed element", () => {
    expect(
      elementToScreen({
        box: { left: 10, top: 20 },
        linear: [1, 0, 0, 1, 0, 0],
        origin: [50, 25],
        size: [100, 50],
      }),
    ).toEqual([1, 0, 0, 1, 10, 20]);
  });

  it("applies the element's own transform about its transform-origin", () => {
    // A 100x50 element rotated a quarter turn occupies a 50x100 screen box, so
    // its local (0,0) corner sits at the box's top-right rather than top-left.
    const matrix = elementToScreen({
      box: { left: 10, top: 20 },
      linear: rotate(Math.PI / 2),
      origin: [50, 25],
      size: [100, 50],
    });
    expect(matrix[0]).toBeCloseTo(0);
    expect(matrix[1]).toBeCloseTo(1);
    expect(matrix[2]).toBeCloseTo(-1);
    expect(matrix[3]).toBeCloseTo(0);
    expect(matrix[4]).toBeCloseTo(60);
    expect(matrix[5]).toBeCloseTo(20);
  });

  it("accounts for scale shrinking the on-screen box", () => {
    // Scaled about its centre, a half-size 100x100 element keeps its centre and
    // reports a 50x50 box, so local (0,0) still maps to the box's top-left.
    expect(
      elementToScreen({
        box: { left: 0, top: 0 },
        linear: [0.5, 0, 0, 0.5, 0, 0],
        origin: [50, 50],
        size: [100, 100],
      }),
    ).toEqual([0.5, 0, 0, 0.5, 0, 0]);
  });
});
