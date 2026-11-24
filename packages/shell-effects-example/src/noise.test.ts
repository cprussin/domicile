import { describe, expect, it } from "bun:test";

import { noisePixels } from "./noise";

const SIDE = 64;

/** The red channel of row `y`. */
const row = (pixels: Uint8ClampedArray, y: number): number[] =>
  Array.from({ length: SIDE }, (_, x) => pixels[(y * SIDE + x) * 4] ?? 0);

/** The largest step between neighbors in `values`. */
const largestStep = (values: readonly number[]): number =>
  Math.max(
    ...values
      .slice(1)
      .map((value, index) => Math.abs(value - (values[index] ?? 0))),
  );

describe("noisePixels", () => {
  it("is an opaque RGBA square", () => {
    const pixels = noisePixels(SIDE);

    expect(pixels.length).toBe(SIDE * SIDE * 4);
    expect(
      pixels.filter((_, index) => index % 4 === 3).every((a) => a === 255),
    ).toBe(true);
  });

  it("tiles: its last column runs on into its first", () => {
    const red = row(noisePixels(SIDE), 10);
    const wrap = Math.abs((red[SIDE - 1] ?? 0) - (red[0] ?? 0));

    expect(wrap).toBeLessThanOrEqual(largestStep(red));
  });

  it("holds a different field in each color channel", () => {
    const pixels = noisePixels(SIDE);
    const channel = (offset: number) =>
      pixels.filter((_, index) => index % 4 === offset).join();

    expect(new Set([channel(0), channel(1), channel(2)]).size).toBe(3);
  });

  it("is the same noise each time", () => {
    expect(noisePixels(SIDE)).toEqual(noisePixels(SIDE));
  });
});
