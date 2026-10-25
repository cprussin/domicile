import { describe, expect, it } from "bun:test";

import {
  nightEnd,
  nightsAround,
  Schedule,
  strengthAt,
} from "./night-light-schedule";

const SAN_FRANCISCO = [37.8, -122.4] as const;
const TROMSO = [69.6, 18.9] as const;
const LATE = { from: 22 * 60, to: 7 * 60 };

/** A local time, or a UTC one ending in `Z`. */
const at = (text: string) => new Date(text);

describe("strengthAt", () => {
  it("is neutral by day and warm at night", () => {
    const hours = Schedule.Hours(LATE);
    const strength = (text: string) =>
      strengthAt(at(text), nightsAround(at(text), hours));

    expect(strength("2026-11-10T15:00")).toBe(0);
    expect(strength("2026-11-10T23:30")).toBe(1);
    expect(strength("2026-11-11T03:00")).toBe(1);
  });

  it("eases in over half an hour and out before the end", () => {
    const hours = Schedule.Hours(LATE);
    const strength = (text: string) =>
      strengthAt(at(text), nightsAround(at(text), hours));

    expect(strength("2026-11-10T22:15")).toBeCloseTo(0.5);
    expect(strength("2026-11-11T06:45")).toBeCloseTo(0.5);
    expect(strength("2026-11-11T07:00")).toBe(0);
  });

  it("follows the sun", () => {
    const sun = Schedule.Sun(SAN_FRANCISCO, LATE);
    const strength = (text: string) =>
      strengthAt(at(text), nightsAround(at(text), sun));

    // Sunset is about 00:59 UTC, and sunrise about 14:46 UTC.
    expect(strength("2026-11-11T00:45Z")).toBe(0);
    expect(strength("2026-11-11T02:00Z")).toBe(1);
    expect(strength("2026-11-11T14:00Z")).toBe(1);
    expect(strength("2026-11-11T15:00Z")).toBe(0);
  });

  it("keeps to the hours without a sunset", () => {
    const sun = Schedule.Sun(TROMSO, LATE);
    const strength = (text: string) =>
      strengthAt(at(text), nightsAround(at(text), sun));

    expect(strength("2026-06-21T15:00")).toBe(0);
    expect(strength("2026-06-21T23:30")).toBe(1);
  });
});

describe("nightEnd", () => {
  it("is the end of this night, or of the next", () => {
    const hours = Schedule.Hours(LATE);
    const end = (text: string) =>
      nightEnd(at(text), nightsAround(at(text), hours));

    expect(end("2026-11-11T03:00")).toEqual(at("2026-11-11T07:00"));
    expect(end("2026-11-11T15:00")).toEqual(at("2026-11-12T07:00"));
  });
});
