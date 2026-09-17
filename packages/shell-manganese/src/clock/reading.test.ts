import { describe, expect, it } from "bun:test";

import { reading } from "./reading";

describe("reading", () => {
  it("names the day, dates it and tells the time to the second", () => {
    expect(reading(new Date(2026, 8, 16, 20, 53, 40))).toBe(
      "Wednesday 2026-09-16 20:53:40",
    );
  });

  it("pads every field the ISO date and a 24-hour clock pad", () => {
    // A single-digit month, day, hour, minute and second in one reading, which
    // is the whole of what the padding has to answer for.
    expect(reading(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "Friday 2026-01-02 03:04:05",
    );
  });

  it("reads midnight as the hour it is rather than as noon", () => {
    // A 24-hour clock, so the hour a 12-hour one calls 12 AM is 00.
    expect(reading(new Date(2026, 8, 16, 0, 0, 0))).toBe(
      "Wednesday 2026-09-16 00:00:00",
    );
  });
});
