import { describe, expect, it } from "bun:test";

import { brightnessFor, offsetFor } from "./auto-brightness-curve";

describe("brightnessFor", () => {
  it("is dim in the dark and full in daylight", () => {
    expect(brightnessFor(0, 0)).toBeCloseTo(0.1);
    expect(brightnessFor(100, 0)).toBeCloseTo(0.55, 2);
    expect(brightnessFor(10_000, 0)).toBe(1);
  });

  it("rises with the light", () => {
    expect(brightnessFor(300, 0)).toBeGreaterThan(brightnessFor(50, 0));
  });

  it("moves by the learned offset, never off or past full", () => {
    expect(brightnessFor(100, -0.2)).toBeCloseTo(0.35, 2);
    expect(brightnessFor(0, -1)).toBe(0.01);
    expect(brightnessFor(1000, 1)).toBe(1);
  });
});

describe("offsetFor", () => {
  it("is what puts the curve at the level the user chose", () => {
    const offset = offsetFor(100, 0.3);

    expect(brightnessFor(100, offset)).toBeCloseTo(0.3);
  });
});
