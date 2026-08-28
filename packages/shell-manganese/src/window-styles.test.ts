import { describe, expect, it } from "bun:test";

import { floatPlacement } from "./window-styles";

const BOX = { height: 200, width: 300, x: 10, y: 20 };

describe("floatPlacement", () => {
  it("places a floating window in the desktop's own coordinates", () => {
    // `fixed`, not `absolute`. A float laid out against the stage cannot leave
    // it, and the stage begins where the rail ends — so a window could never
    // be dragged over the rail, which is most of the left-hand edge of the
    // screen. The page spans the whole desktop, so the viewport *is* the
    // desktop: a float at 0 is at the desktop's own corner, over the rail,
    // which is where a floating window is allowed to be.
    expect(floatPlacement(BOX, 0).position).toBe("fixed");
  });

  it("puts the window where the box says", () => {
    expect(floatPlacement(BOX, 0)).toMatchObject({
      blockSize: "200px",
      inlineSize: "300px",
      insetBlockStart: "20px",
      insetInlineStart: "10px",
    });
  });

  it("stacks a float above the stage, and each above the one below", () => {
    const under = Number(floatPlacement(BOX, 0).zIndex);
    const over = Number(floatPlacement(BOX, 1).zIndex);
    expect(under).toBeGreaterThan(0);
    expect(over).toBeGreaterThan(under);
  });
});
