import { describe, expect, it } from "bun:test";

import { applicationsConfigSchema } from "./applications-config";

describe("applicationsConfigSchema", () => {
  it("omits nothing and has no bookmarks when left out", () => {
    expect(applicationsConfigSchema.parse(undefined)).toStrictEqual({
      bookmarks: [],
      omit: [],
    });
  });

  it("refuses a bookmark that is not a web address", () => {
    expect(
      applicationsConfigSchema.safeParse({
        bookmarks: [{ name: "Calendar", url: "calendar.example" }],
      }).success,
    ).toBe(false);
  });
});
