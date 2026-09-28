import { describe, expect, it } from "bun:test";

import { barMotion } from "./window-motion";

describe("barMotion", () => {
  // The bar of a window in a tabbed container is its tab, which stays on
  // screen while the contents under it crossfade.
  it("keeps a tab switch off the bar", () => {
    expect([barMotion("revealing"), barMotion("concealing")]).toStrictEqual([
      "resting",
      "resting",
    ]);
  });

  it("carries every other motion onto it", () => {
    expect(barMotion("opening")).toBe("opening");
  });
});
