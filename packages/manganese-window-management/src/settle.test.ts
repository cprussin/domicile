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
  it("undoes the settle's scale at every step", () => {
    const steps = uprightAlong(FROM, 4);

    expect(steps.map(({ at }) => at)).toStrictEqual([0, 0.25, 0.5, 0.75, 1]);
    for (const { at, scaleX, scaleY } of steps) {
      const settled = partway(FROM, at);
      expect(scaleX * settled.scaleX).toBeCloseTo(1);
      expect(scaleY * settled.scaleY).toBeCloseTo(1);
    }
  });
});
