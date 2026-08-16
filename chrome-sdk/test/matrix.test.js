import { describe, it, expect } from "vitest";
import {
  IDENTITY,
  translate,
  scale,
  rotate,
  multiply,
  invert,
  apply,
  accumulate,
} from "../src/matrix.js";

const close = (a, b) => Math.abs(a - b) < 1e-9;
const expectPoint = (p, x, y) => {
  expect(close(p[0], x), `x: got ${p[0]} want ${x}`).toBe(true);
  expect(close(p[1], y), `y: got ${p[1]} want ${y}`).toBe(true);
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
    const m = multiply(scale(2, 2), translate(10, 20));
    expectPoint(apply(m, [0, 0]), 20, 40);
    expectPoint(apply(m, [1, 1]), 22, 42);
  });

  it("invert round-trips", () => {
    const m = multiply(multiply(scale(2, 1.5), rotate(0.7)), translate(30, -5));
    const inv = invert(m);
    expectPoint(apply(inv, apply(m, [12, 34])), 12, 34);
  });

  it("returns null inverting a singular matrix", () => {
    expect(invert(scale(0, 0))).toBeNull();
  });

  it("accumulate composes an element->root chain (element first)", () => {
    // element is scaled 2x, sitting inside a parent translated +10x.
    const screen = accumulate([scale(2, 2), translate(10, 0)]);
    expectPoint(apply(screen, [5, 5]), 20, 10);
  });
});
