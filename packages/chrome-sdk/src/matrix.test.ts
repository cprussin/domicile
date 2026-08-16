import { describe, expect, it } from "bun:test";
import type { Point } from "./matrix";
import {
  accumulate,
  apply,
  IDENTITY,
  invert,
  multiply,
  rotate,
  scale,
  translate,
} from "./matrix";

const TOLERANCE = 9;

const expectPoint = (point: Point, x: number, y: number): void => {
  expect(point[0]).toBeCloseTo(x, TOLERANCE);
  expect(point[1]).toBeCloseTo(y, TOLERANCE);
};

describe("matrix", () => {
  it("identity is a no-op", () => {
    expectPoint(apply(IDENTITY, [3, 4]), 3, 4);
  });

  it("translate and scale apply", () => {
    expectPoint(apply(translate(10, 20), [1, 2]), 11, 22);
    expectPoint(apply(scale(2, 3), [4, 5]), 8, 15);
  });

  it("rotate 90deg ccw sends (1,0) to (0,1)", () => {
    expectPoint(apply(rotate(Math.PI / 2), [1, 0]), 0, 1);
  });

  it("multiply(a,b) applies b then a", () => {
    // scale-of-translate: translate first, then scale the result.
    const matrix = multiply(scale(2, 2), translate(10, 20));
    expectPoint(apply(matrix, [0, 0]), 20, 40);
    expectPoint(apply(matrix, [1, 1]), 22, 42);
  });

  it("invert round-trips", () => {
    const matrix = multiply(
      multiply(scale(2, 1.5), rotate(0.7)),
      translate(30, -5),
    );
    const inverse = invert(matrix);
    if (inverse === undefined) {
      throw new Error("a non-singular matrix must invert");
    }
    expectPoint(apply(inverse, apply(matrix, [12, 34])), 12, 34);
  });

  it("returns undefined inverting a singular matrix", () => {
    expect(invert(scale(0, 0))).toBeUndefined();
  });

  it("accumulate composes an element->root chain (element first)", () => {
    // element is scaled 2x, sitting inside a parent translated +10x.
    const screen = accumulate([scale(2, 2), translate(10, 0)]);
    expectPoint(apply(screen, [5, 5]), 20, 10);
  });
});
