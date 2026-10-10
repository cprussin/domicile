import { describe, expect, it } from "bun:test";

import { drawnAt, offsetFrom, partway } from "./settle";

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
