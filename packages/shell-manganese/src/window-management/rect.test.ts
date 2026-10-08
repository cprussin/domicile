import { describe, expect, it } from "bun:test";

import type { Rect } from "./rect";
import { barOf, SURFACE_TUCK, surfaceOf, TITLE_BAR } from "./rect";

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

  it("puts the surface under the bar, its top edge tucked beneath it", () => {
    // The bar draws over the tuck. Edges at fractional device pixels then
    // blend into the surface, not into the desktop behind a sliver.
    expect(SURFACE_TUCK).toBeGreaterThanOrEqual(1);
    expect(surfaceOf(FRAME)).toStrictEqual({
      height: FRAME.height - TITLE_BAR + SURFACE_TUCK,
      width: FRAME.width,
      x: FRAME.x,
      y: FRAME.y + TITLE_BAR - SURFACE_TUCK,
    });
  });

  it("keeps the surface inside the window's box", () => {
    // A window's box includes its title bar.
    const surface = surfaceOf(FRAME);
    expect(surface.y + surface.height).toBe(FRAME.y + FRAME.height);
  });

  it("never gives the surface a negative height", () => {
    // A negative height would break the compositor.
    expect(surfaceOf({ ...FRAME, height: 1 }).height).toBe(0);
  });
});
