import { describe, expect, it } from "bun:test";

import { SPRINGS, springEasing } from "./springs";

describe("springEasing", () => {
  it("runs from the start to the end", () => {
    const stops = stopsOf(springEasing(SPRINGS.smooth).easing);
    expect([stops.at(0), stops.at(-1)]).toStrictEqual([0, 1]);
  });

  it("overshoots only for an underdamped spring", () => {
    expect(peak(SPRINGS.snappy)).toBe(1);
    expect(peak(SPRINGS.smooth)).toBe(1);
    expect(peak(SPRINGS.bouncy)).toBeGreaterThan(1.05);
  });

  it("lasts as long as the spring takes to settle", () => {
    // A critically damped spring stays within 0.1% of its target from
    // ωt ≈ 9.2334, where ω = √(stiffness / mass).
    const settleMs = (9.2334 / Math.sqrt(400)) * 1000;
    const { duration } = springEasing({ damping: 40, mass: 1, stiffness: 400 });
    expect(Math.abs(Number.parseInt(duration, 10) - settleMs)).toBeLessThan(1);
  });

  it("settles an overdamped spring slower than a critically damped one", () => {
    const critical = { damping: 40, mass: 1, stiffness: 400 };
    const overdamped = { ...critical, damping: 80 };
    expect(peak(overdamped)).toBe(1);
    expect(
      Number.parseInt(springEasing(overdamped).duration, 10),
    ).toBeGreaterThan(Number.parseInt(springEasing(critical).duration, 10));
  });

  it("orders the springs from fastest to slowest to settle", () => {
    const durations = [SPRINGS.snappy, SPRINGS.smooth, SPRINGS.bouncy].map(
      (spring) => Number.parseInt(springEasing(spring).duration, 10),
    );
    expect(durations).toStrictEqual(durations.toSorted((a, b) => a - b));
  });
});

/** The output values of a CSS `linear()` easing. */
const stopsOf = (easing: string): number[] =>
  easing
    .replace(/^linear\(|\)$/g, "")
    .split(",")
    .map((stop) => Number.parseFloat(stop));

const peak = (spring: Parameters<typeof springEasing>[0]): number =>
  Math.max(...stopsOf(springEasing(spring).easing));
