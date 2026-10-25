import { describe, expect, it } from "bun:test";

import type { SunTimes } from "./sun-times";
import { sunTimes } from "./sun-times";

const SAN_FRANCISCO = [37.8, -122.4] as const;
const TROMSO = [69.6, 18.9] as const;

const MINUTE = 60_000;

const times = (found: ReturnType<typeof sunTimes>): SunTimes =>
  found.match({
    None: () => {
      throw new Error("the sun neither rose nor set");
    },
    Some: (sun) => sun,
  });

describe("sunTimes", () => {
  // The US Naval Observatory gives 05:48 and 20:35 PDT.
  it("finds a summer day's sunrise and sunset", () => {
    const { sunrise, sunset } = times(sunTimes(2026, 5, 21, SAN_FRANCISCO));

    expect(
      Math.abs(sunrise.getTime() - Date.parse("2026-06-21T12:48:00Z")),
    ).toBeLessThan(3 * MINUTE);
    expect(
      Math.abs(sunset.getTime() - Date.parse("2026-06-22T03:35:00Z")),
    ).toBeLessThan(3 * MINUTE);
  });

  // The US Naval Observatory gives 07:22 and 16:55 PST.
  it("finds a winter day's sunrise and sunset", () => {
    const { sunrise, sunset } = times(sunTimes(2026, 11, 21, SAN_FRANCISCO));

    expect(
      Math.abs(sunrise.getTime() - Date.parse("2026-12-21T15:22:00Z")),
    ).toBeLessThan(3 * MINUTE);
    expect(
      Math.abs(sunset.getTime() - Date.parse("2026-12-22T00:55:00Z")),
    ).toBeLessThan(3 * MINUTE);
  });

  it("finds none in a polar summer or winter", () => {
    expect(sunTimes(2026, 5, 21, TROMSO).isNone()).toBe(true);
    expect(sunTimes(2026, 11, 21, TROMSO).isNone()).toBe(true);
  });
});
