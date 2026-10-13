import { describe, expect, it } from "bun:test";

import { barMotion, isMoving } from "./window-motion";

describe("barMotion", () => {
  // The bar of a window in a tabbed container is its tab, which stays on
  // screen while the contents under it crossfade.
  it("keeps a tab switch off the bar", () => {
    expect([
      barMotion("revealing"),
      barMotion("concealing"),
      barMotion("uncovering"),
    ]).toStrictEqual(["resting", "resting", "resting"]);
  });

  it("carries every other motion onto it", () => {
    expect(barMotion("opening")).toBe("opening");
  });
});

describe("isMoving", () => {
  it("is a motion that moves or scales the window", () => {
    expect([
      isMoving("arriving-from-end"),
      isMoving("opening"),
      isMoving("restacking"),
    ]).toStrictEqual([true, true, true]);
  });

  // A tab switch only fades.
  it("is not resting or a tab switch", () => {
    expect([
      isMoving("resting"),
      isMoving("revealing"),
      isMoving("concealing"),
      isMoving("uncovering"),
    ]).toStrictEqual([false, false, false, false]);
  });
});
