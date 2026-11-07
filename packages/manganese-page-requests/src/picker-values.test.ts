import { describe, expect, it } from "bun:test";

import {
  addDays,
  calendarOf,
  formatDate,
  formatDateTime,
  formatMonth,
  formatTime,
  formatWeek,
  hexToHsv,
  hsvToHex,
  isWithin,
  parseDate,
  parseDateTime,
  parseHex,
  parseMonth,
  parseTime,
  parseWeek,
  weekOf,
} from "./picker-values";

describe("picker values", () => {
  it("reads and writes each input's format", () => {
    expect(parseDate("2026-11-06")).toEqual({ day: 6, month: 11, year: 2026 });
    expect(formatDate({ day: 6, month: 11, year: 2026 })).toBe("2026-11-06");
    expect(parseMonth("2026-11")).toEqual({ day: 1, month: 11, year: 2026 });
    expect(formatMonth({ day: 9, month: 2, year: 2026 })).toBe("2026-02");
    expect(parseTime("13:45:30")).toEqual({ hour: 13, minute: 45 });
    expect(formatTime({ hour: 9, minute: 5 })).toBe("09:05");
    expect(parseDateTime("2026-11-06T13:45")).toEqual({
      day: { day: 6, month: 11, year: 2026 },
      time: { hour: 13, minute: 45 },
    });
    expect(
      formatDateTime({ day: 6, month: 11, year: 2026 }, { hour: 8, minute: 0 }),
    ).toBe("2026-11-06T08:00");
  });

  it("refuses what is not a value", () => {
    expect(parseDate("")).toBeUndefined();
    expect(parseDate("2026-02-30")).toBeUndefined();
    expect(parseMonth("2026-13")).toBeUndefined();
    expect(parseTime("24:00")).toBeUndefined();
    expect(parseWeek("2026-W54")).toBeUndefined();
    expect(parseHex("blue")).toBeUndefined();
  });

  it("numbers weeks as ISO 8601 does, across years", () => {
    expect(formatWeek({ day: 6, month: 11, year: 2026 })).toBe("2026-W45");
    // Thursday 2026-01-01 starts week 1 of 2026.
    expect(weekOf({ day: 29, month: 12, year: 2025 })).toEqual({
      week: 1,
      year: 2026,
    });
    expect(parseWeek("2026-W01")).toEqual({ day: 29, month: 12, year: 2025 });
    expect(parseWeek("2026-W45")).toEqual({ day: 2, month: 11, year: 2026 });
  });

  it("lays a month out in whole weeks from Sunday", () => {
    const weeks = calendarOf(2026, 11);
    // November 2026 starts on a Sunday and ends on a Monday.
    expect(weeks[0]?.[0]).toEqual({ day: 1, month: 11, year: 2026 });
    expect(weeks.at(-1)?.[0]).toEqual({ day: 29, month: 11, year: 2026 });
    expect(weeks.at(-1)?.[6]).toEqual({ day: 5, month: 12, year: 2026 });
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("steps days across months and checks bounds", () => {
    expect(addDays({ day: 31, month: 12, year: 2026 }, 1)).toEqual({
      day: 1,
      month: 1,
      year: 2027,
    });
    const min = { day: 1, month: 11, year: 2026 };
    expect(isWithin({ day: 31, month: 10, year: 2026 }, min, undefined)).toBe(
      false,
    );
    expect(isWithin(min, min, min)).toBe(true);
  });

  it("turns colors between hex and HSV", () => {
    expect(parseHex("1971C2")).toBe("#1971c2");
    for (const hex of ["#1971c2", "#000000", "#ffffff", "#ff0000", "#40c057"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
    expect(hexToHsv("#ff0000")).toEqual({ hue: 0, saturation: 1, value: 1 });
  });
});
