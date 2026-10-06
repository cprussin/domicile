import { describe, expect, it } from "bun:test";

import type { Bookmark } from "./bookmark";
import { bookmarksSchema, findBookmarks } from "./bookmark";

const OFFERED: readonly Bookmark[] = [
  { name: "Mail", url: "https://mail.google.com" },
  { name: "Calendar", url: "https://calendar.google.com" },
  { name: "Code Review", url: "https://github.com/pulls" },
];

const names = (found: readonly Bookmark[]): string[] =>
  found.map(({ name }) => name);

describe("findBookmarks", () => {
  it("matches every word against the name or the URL, ignoring case", () => {
    expect(names(findBookmarks(OFFERED, "REVIEW", 10))).toStrictEqual([
      "Code Review",
    ]);
    expect(names(findBookmarks(OFFERED, "github pulls", 10))).toStrictEqual([
      "Code Review",
    ]);
    expect(findBookmarks(OFFERED, "mail nope", 10)).toStrictEqual([]);
  });

  it("puts names that start with the query first, then sorts by name", () => {
    expect(names(findBookmarks(OFFERED, "c", 10))).toStrictEqual([
      "Calendar",
      "Code Review",
      "Mail",
    ]);
  });

  it("offers no more than the limit", () => {
    expect(names(findBookmarks(OFFERED, "", 2))).toStrictEqual([
      "Calendar",
      "Code Review",
    ]);
  });
});

describe("bookmarksSchema", () => {
  it("reads a name and the web address it opens", () => {
    expect(
      bookmarksSchema.parse([
        { name: "Calendar", url: "https://calendar.google.com" },
        { name: "Router", url: "HTTP://router.home" },
      ]),
    ).toStrictEqual([
      { name: "Calendar", url: "https://calendar.google.com" },
      { name: "Router", url: "HTTP://router.home" },
    ]);
  });

  it.each([
    ["not a web address", { name: "Calendar", url: "calendar.google.com" }],
    ["another scheme", { name: "Files", url: "file:///home" }],
    ["no host", { name: "Nowhere", url: "https://" }],
    ["no URL", { name: "Calendar" }],
    [
      "more than a name and a URL",
      { name: "Calendar", shortcut: "!c", url: "https://calendar.google.com" },
    ],
  ])("refuses %s", (_, bookmark) => {
    expect(bookmarksSchema.safeParse([bookmark]).success).toBe(false);
  });
});
