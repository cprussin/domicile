import { describe, expect, it } from "bun:test";

import { reading } from "./reading";

describe("reading", () => {
  it("names the day, dates it and tells the time to the second", () => {
    expect(reading(new Date(2026, 8, 16, 20, 53, 40))).toBe(
      "Wednesday 2026-09-16 20:53:40",
    );
  });

  it("pads every field the ISO date and a 24-hour clock pad", () => {
    // Every field is single-digit, so all need padding.
    expect(reading(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "Friday 2026-01-02 03:04:05",
    );
  });

  it("reads midnight as the hour it is rather than as noon", () => {
    // 24-hour clock: 12 AM is 00.
    expect(reading(new Date(2026, 8, 16, 0, 0, 0))).toBe(
      "Wednesday 2026-09-16 00:00:00",
    );
  });
});
