import { describe, expect, it } from "bun:test";

import { runManganese } from "./index";

describe("runManganese", () => {
  it("refuses a bookmark that is not a web address", () => {
    expect(() =>
      runManganese({
        applications: { bookmarks: [{ name: "Mail", url: "mail.example" }] },
      }),
    ).toThrow("http or https");
  });
});
