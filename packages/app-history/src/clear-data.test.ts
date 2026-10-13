import { describe, expect, it } from "bun:test";

import { DataKind, dataTypes, since, TimeRange } from "./clear-data";

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

describe(dataTypes, () => {
  it("names the browser's data types for each kind", () => {
    expect(
      dataTypes(
        new Set([
          DataKind.History,
          DataKind.Cache,
          DataKind.Downloads,
          DataKind.FormData,
          DataKind.Passwords,
        ]),
      ),
    ).toEqual(["history", "cache", "downloads", "formData", "passwords"]);
  });

  it("takes site storage with cookies, as Chrome's dialog does", () => {
    expect(dataTypes(new Set([DataKind.Cookies]))).toEqual([
      "cacheStorage",
      "cookies",
      "fileSystems",
      "indexedDB",
      "localStorage",
      "serviceWorkers",
      "webSQL",
    ]);
  });
});
