import { describe, expect, it } from "bun:test";

import { drawnAt, offsetFrom, partway, uprightAlong } from "./settle";

const WAS = { height: 400, width: 600, x: 100, y: 50 };
const NOW = { height: 800, width: 1200, x: 0, y: 30 };
// The middle of `NOW`, from its corner.
const MIDDLE = { x: 600, y: 400 };

describe("offsetFrom", () => {
  it("draws the new box over the old one", () => {
    const offset = offsetFrom(WAS, NOW, MIDDLE);

    expect(drawnAt(NOW, MIDDLE, offset)).toStrictEqual(WAS);
  });

  it("is no offset for a box that did not change", () => {
    expect(offsetFrom(NOW, NOW, MIDDLE)).toStrictEqual({
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
    });
  });

  // Offsets apply about the element's `transform-origin`.
  it("scales about the origin it is given", () => {
    expect(offsetFrom(WAS, NOW, { x: 0, y: 0 })).toStrictEqual({
      scaleX: 0.5,
      scaleY: 0.5,
      x: 100,
      y: 20,
    });
    expect(offsetFrom(WAS, NOW, MIDDLE)).toStrictEqual({
      scaleX: 0.5,
      scaleY: 0.5,
      x: -200,
      y: -180,
    });
  });
});

describe("drawnAt", () => {
  it("is the box itself with no offset", () => {
    expect(
      drawnAt(NOW, MIDDLE, { scaleX: 1, scaleY: 1, x: 0, y: 0 }),
    ).toStrictEqual(NOW);
  });
});

describe("partway", () => {
  it("is the offset that far into easing from `from` to none", () => {
    expect(
      partway({ scaleX: 0.5, scaleY: 2, x: -200, y: 40 }, 0.25),
    ).toStrictEqual({ scaleX: 0.625, scaleY: 1.75, x: -150, y: 30 });
  });
});

describe("uprightAlong", () => {
  const FROM = { scaleX: 0.25, scaleY: 2, x: 40, y: -10 };

  // A part drawn at its own size inside a settling element, such as a title.
  it("undoes the settle's scale at every step, from start to end", () => {
    const steps = uprightAlong(FROM);

    expect(steps[0]?.at).toBe(0);
    expect(steps.at(-1)?.at).toBe(1);
    for (const { at, scaleX, scaleY } of steps) {
      const settled = partway(FROM, at);
      expect(scaleX * settled.scaleX).toBeCloseTo(1);
      expect(scaleY * settled.scaleY).toBeCloseTo(1);
    }
  });

  // The browser interpolates between steps linearly, but the inverse of a
  // linear ease is not linear. A window's contents span the whole window, so
  // a small error between steps would show as their pixels stretching.
  it("keeps a part within a thousandth of its own size between steps", () => {
    const from = { scaleX: 0.1, scaleY: 1.5, x: 0, y: 0 };
    const steps = uprightAlong(from);

    for (const [index, step] of steps.slice(1).entries()) {
      const before = steps[index];
      if (before === undefined) {
        throw new Error("test: a step has no step before it");
      }
      const settled = partway(from, (before.at + step.at) / 2);
      expect(
        Math.abs(((before.scaleX + step.scaleX) / 2) * settled.scaleX - 1),
      ).toBeLessThan(0.001);
      expect(
        Math.abs(((before.scaleY + step.scaleY) / 2) * settled.scaleY - 1),
      ).toBeLessThan(0.001);
    }
  });
});
