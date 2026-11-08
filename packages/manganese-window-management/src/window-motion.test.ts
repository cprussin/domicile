import { describe, expect, it } from "bun:test";

import { barMotion, isMoving, isSlidingIn } from "./window-motion";

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

describe("isSlidingIn", () => {
  // These bring in a window that was not drawn, whose client draws again.
  it("is a workspace switch or the scratchpad bringing the window in", () => {
    expect([
      isSlidingIn("arriving-from-end"),
      isSlidingIn("arriving-from-start"),
      isSlidingIn("dropping"),
    ]).toStrictEqual([true, true, true]);
  });

  it("is not a slide taking the window away", () => {
    expect([
      isSlidingIn("leaving-to-end"),
      isSlidingIn("stowing"),
    ]).toStrictEqual([false, false]);
  });
});
