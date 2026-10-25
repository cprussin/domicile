import { describe, expect, it } from "bun:test";

import { colorTemperature, NEUTRAL } from "./color-temperature";

describe("colorTemperature", () => {
  it("is neutral before the night light eases in", () => {
    expect(colorTemperature(50, 0)).toBe(NEUTRAL);
  });

  it("warms from 6000K to 2000K", () => {
    expect(colorTemperature(0, 1)).toBe(6000);
    expect(colorTemperature(50, 1)).toBe(3000);
    expect(colorTemperature(100, 1)).toBe(2000);
  });

  it("eases in evenly in mireds", () => {
    // Halfway between 153.8 and 333.3 mireds.
    expect(colorTemperature(50, 0.5)).toBe(4105);
  });
});
