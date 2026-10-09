import { describe, expect, it } from "bun:test";

import { DataKind, dataToRemove, since, TimeRange } from "./clear-data";

const NOW = 10 * 24 * 60 * 60 * 1000 * 7 * 4;

describe(since, () => {
  it.each([
    [TimeRange.LastHour, NOW - 60 * 60 * 1000],
    [TimeRange.LastDay, NOW - 24 * 60 * 60 * 1000],
    [TimeRange.LastWeek, NOW - 7 * 24 * 60 * 60 * 1000],
    [TimeRange.LastFourWeeks, NOW - 28 * 24 * 60 * 60 * 1000],
    [TimeRange.AllTime, 0],
  ])("starts range %p at %p", (range, expected) => {
    expect(since(range, NOW)).toBe(expected);
  });
});

describe(dataToRemove, () => {
  it("names the browser's data types for each kind", () => {
    expect(
      dataToRemove(
        new Set([
          DataKind.History,
          DataKind.Cache,
          DataKind.Downloads,
          DataKind.FormData,
          DataKind.Passwords,
        ]),
      ),
    ).toEqual({
      cache: true,
      downloads: true,
      formData: true,
      history: true,
      passwords: true,
    });
  });

  it("takes site storage with cookies, as Chrome's dialog does", () => {
    expect(dataToRemove(new Set([DataKind.Cookies]))).toEqual({
      cacheStorage: true,
      cookies: true,
      fileSystems: true,
      indexedDB: true,
      localStorage: true,
      serviceWorkers: true,
      webSQL: true,
    });
  });
});
