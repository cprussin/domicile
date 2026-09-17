import { describe, expect, it } from "bun:test";

import type { Rect } from "./rect";
import { barOf, surfaceOf, TITLE_BAR } from "./rect";

const FRAME: Rect = { height: 420, width: 640, x: 100, y: 80 };

describe("the parts of a window's frame", () => {
  it("puts the bar along the top of it", () => {
    expect(barOf(FRAME)).toStrictEqual({
      height: TITLE_BAR,
      width: FRAME.width,
      x: FRAME.x,
      y: FRAME.y,
    });
  });

  it("puts the surface under the bar", () => {
    expect(surfaceOf(FRAME)).toStrictEqual({
      height: FRAME.height - TITLE_BAR,
      width: FRAME.width,
      x: FRAME.x,
      y: FRAME.y + TITLE_BAR,
    });
  });

  it("takes the bar out of the window rather than adding it on", () => {
    // A window's box is the whole frame, so a window dragged to a size is
    // that size, bar included, and a resize needs no frame that grows with it.
    expect(barOf(FRAME).height + surfaceOf(FRAME).height).toBe(FRAME.height);
  });

  it("never gives the surface a negative height", () => {
    // Nothing places a window shorter than its own bar, so this holds — but a
    // negative height reaches the compositor as a window turned inside out.
    expect(surfaceOf({ ...FRAME, height: 1 }).height).toBe(0);
  });
});
