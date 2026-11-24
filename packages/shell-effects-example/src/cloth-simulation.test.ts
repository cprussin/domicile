import { describe, expect, it } from "bun:test";

import type { Cloth } from "./cloth-simulation";
import { clothArrays, restingCloth, stepCloth } from "./cloth-simulation";

const COLUMNS = 8;
const ROWS = 6;
const WIDTH = 800;
const HEIGHT = 600;

/** `cloth` after `seconds` of 60 Hz frames. */
const after = (cloth: Cloth, seconds: number): Cloth =>
  Array.from({ length: Math.round(seconds * 60) }).reduce<Cloth>(
    (stepped) => stepCloth(stepped, 1 / 60),
    cloth,
  );

/** Each point's offset from where it rests, and its shade. */
const points = (cloth: Cloth) => {
  const arrays = clothArrays(cloth);
  return Array.from({ length: arrays.length / 4 }, (_, index) => ({
    shade: arrays[index * 4 + 2] ?? Number.NaN,
    x: arrays[index * 4] ?? Number.NaN,
    y: arrays[index * 4 + 1] ?? Number.NaN,
  }));
};

describe("the cloth", () => {
  it("holds four floats for each grid point, all zero at rest", () => {
    const arrays = clothArrays(restingCloth(COLUMNS, ROWS, WIDTH, HEIGHT));

    expect(arrays.length).toBe(4 * (COLUMNS + 1) * (ROWS + 1));
    expect(arrays.every((value) => value === 0)).toBe(true);
  });

  it("hangs from its top edge until each point there lets go", () => {
    const early = points(
      after(restingCloth(COLUMNS, ROWS, WIDTH, HEIGHT), 0.1),
    );
    const topRight = early[COLUMNS];
    const bottomLeft = early[ROWS * (COLUMNS + 1)];

    expect([topRight?.x, topRight?.y]).toEqual([0, 0]);
    expect(Math.hypot(bottomLeft?.x ?? 0, bottomLeft?.y ?? 0)).toBeGreaterThan(
      1,
    );
  });

  it("blows off to the side once it is free", () => {
    const late = points(after(restingCloth(COLUMNS, ROWS, WIDTH, HEIGHT), 1.5));

    expect(late.every((point) => point.x > WIDTH / 4)).toBe(true);
  });

  it("shades folds darker, never past black", () => {
    const shades = points(
      after(restingCloth(COLUMNS, ROWS, WIDTH, HEIGHT), 0.8),
    ).map((point) => point.shade);

    expect(shades.some((shade) => shade > 0)).toBe(true);
    expect(shades.every((shade) => shade >= 0 && shade < 1)).toBe(true);
  });
});
