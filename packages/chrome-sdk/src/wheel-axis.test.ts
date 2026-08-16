import { describe, expect, it } from "bun:test";

import { axisFromWheel } from "./wheel-axis";

describe("axisFromWheel", () => {
  it("passes pixel deltas through and derives the discrete step", () => {
    expect(axisFromWheel({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toEqual({
      dx: 0,
      dy: 100,
      v120X: 0,
      v120Y: 120,
    });
  });

  it("normalises a line-mode wheel to the same detent", () => {
    expect(axisFromWheel({ deltaMode: 1, deltaX: 0, deltaY: -3 })).toEqual({
      dx: 0,
      dy: -100,
      v120X: 0,
      v120Y: -120,
    });
  });

  it("normalises a page-mode wheel to the same detent", () => {
    expect(axisFromWheel({ deltaMode: 2, deltaX: 1, deltaY: 0 })).toEqual({
      dx: 100,
      dy: 0,
      v120X: 120,
      v120Y: 0,
    });
  });

  it("reports a fractional detent for touchpad scrolling", () => {
    // A touchpad reports small pixel deltas; wl_pointer's high-resolution axis
    // carries them as a fraction of the 120-per-detent step.
    expect(axisFromWheel({ deltaMode: 0, deltaX: 0, deltaY: 7 })).toEqual({
      dx: 0,
      dy: 7,
      v120X: 0,
      v120Y: 8,
    });
  });

  it("rejects a delta mode the DOM does not define", () => {
    expect(() => axisFromWheel({ deltaMode: 3, deltaX: 0, deltaY: 1 })).toThrow(
      RangeError,
    );
  });
});
