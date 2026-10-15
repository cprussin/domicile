import { describe, expect, it } from "bun:test";

import { CLOCK_DEFAULTS } from "./clock-options";
import { reading } from "./reading";

describe("reading", () => {
  it("names the day, dates it and tells the time to the second", () => {
    expect(reading(new Date(2026, 8, 16, 20, 53, 40), CLOCK_DEFAULTS)).toBe(
      "Wednesday 2026-09-16 20:53:40",
    );
  });

  it("pads every field the ISO date and a 24-hour clock pad", () => {
    // Every field is single-digit, so all need padding.
    expect(reading(new Date(2026, 0, 2, 3, 4, 5), CLOCK_DEFAULTS)).toBe(
      "Friday 2026-01-02 03:04:05",
    );
  });

  it("reads midnight as the hour it is rather than as noon", () => {
    // 24-hour clock: 12 AM is 00.
    expect(reading(new Date(2026, 8, 16, 0, 0, 0), CLOCK_DEFAULTS)).toBe(
      "Wednesday 2026-09-16 00:00:00",
    );
  });

  it("tells the time on a 12-hour clock, padded, with AM or PM", () => {
    const twelve = { ...CLOCK_DEFAULTS, format: "12h" } as const;
    expect(reading(new Date(2026, 8, 16, 20, 53, 40), twelve)).toBe(
      "Wednesday 2026-09-16 08:53:40 PM",
    );
    expect(reading(new Date(2026, 8, 16, 0, 5, 0), twelve)).toBe(
      "Wednesday 2026-09-16 12:05:00 AM",
    );
    expect(reading(new Date(2026, 8, 16, 12, 0, 0), twelve)).toBe(
      "Wednesday 2026-09-16 12:00:00 PM",
    );
  });

  it("leaves the seconds out when told to", () => {
    expect(
      reading(new Date(2026, 8, 16, 20, 53, 40), {
        ...CLOCK_DEFAULTS,
        seconds: false,
      }),
    ).toBe("Wednesday 2026-09-16 20:53");
  });
});
