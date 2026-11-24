import { describe, expect, it } from "bun:test";

import { flingMs, pointerSpeed } from "./fling";

describe(pointerSpeed, () => {
  it("is the distance between the last two samples over the time between them", () => {
    expect(
      pointerSpeed([
        { time: 0, x: 0, y: 0 },
        { time: 10, x: 30, y: 40 },
      ]),
    ).toBe(5);
  });

  it("is still with fewer than two samples", () => {
    expect(pointerSpeed([{ time: 0, x: 0, y: 0 }])).toBe(0);
  });

  it("is still when the samples share a time", () => {
    expect(
      pointerSpeed([
        { time: 4, x: 0, y: 0 },
        { time: 4, x: 30, y: 40 },
      ]),
    ).toBe(0);
  });
});

describe(flingMs, () => {
  it("keeps the speed it was flung at", () => {
    expect(flingMs(400, 4, 300)).toBe(100);
  });

  it("takes no longer than a release at rest would", () => {
    expect(flingMs(400, 0.5, 300)).toBe(300);
    expect(flingMs(400, 0, 300)).toBe(300);
  });
});
