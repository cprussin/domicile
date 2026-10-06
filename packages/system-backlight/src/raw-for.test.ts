import { describe, expect, it } from "bun:test";

import { rawFor } from "./raw-for";

const PANEL = { device: "intel_backlight", max: 1000, raw: 0 };

describe("rawFor", () => {
  it("rounds the level to the device's scale", () => {
    expect(rawFor(PANEL, 0.4204)).toBe(420);
    expect(rawFor(PANEL, 1)).toBe(1000);
  });

  // Zero turns most panels off, which would leave the user unable to see the
  // slider to undo it.
  it("never turns the screen off or overshoots", () => {
    expect(rawFor(PANEL, 0)).toBe(1);
    expect(rawFor(PANEL, -3)).toBe(1);
    expect(rawFor(PANEL, 7)).toBe(1000);
  });

  it("refuses a level that is not a number", () => {
    expect(() => rawFor(PANEL, Number.NaN)).toThrow("NaN");
    expect(() => rawFor(PANEL, Number.POSITIVE_INFINITY)).toThrow("Infinity");
  });
});
