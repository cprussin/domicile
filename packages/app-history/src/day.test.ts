import { describe, expect, it } from "bun:test";

import { dayLabel, startOfDay, timeOfDay } from "./day";

const NOW = new Date(2026, 9, 9, 15, 42).getTime();

describe(startOfDay, () => {
  it("is local midnight of the day a time falls on", () => {
    expect(startOfDay(new Date(2026, 9, 8, 23, 59, 59).getTime())).toBe(
      new Date(2026, 9, 8).getTime(),
    );
  });
});

describe(dayLabel, () => {
  it("names today", () => {
    expect(dayLabel(startOfDay(NOW), NOW, "en-US")).toEqual({
      date: "Friday, October 9, 2026",
      relative: "Today",
    });
  });

  it("names yesterday", () => {
    expect(dayLabel(new Date(2026, 9, 8).getTime(), NOW, "en-US")).toEqual({
      date: "Thursday, October 8, 2026",
      relative: "Yesterday",
    });
  });

  it("gives only the date for an earlier day", () => {
    expect(dayLabel(new Date(2026, 9, 7).getTime(), NOW, "en-US")).toEqual({
      date: "Wednesday, October 7, 2026",
      relative: undefined,
    });
  });
});

describe(timeOfDay, () => {
  it("gives the hour and minute", () => {
    expect(timeOfDay(NOW, "en-US")).toBe("3:42 PM");
  });
});
