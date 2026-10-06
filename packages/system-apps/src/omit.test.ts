import { describe, expect, it } from "bun:test";

import { omitting } from "./omit";

describe("omitting", () => {
  it("omits nothing with no patterns", () => {
    expect(omitting([])("firefox.desktop")).toBe(false);
  });

  it("takes an ID back with `!`, and the last matching pattern wins", () => {
    const omits = omitting(["*", "!launcher-*", "launcher-old.desktop"]);

    expect(omits("firefox.desktop")).toBe(true);
    expect(omits("launcher-agenda.desktop")).toBe(false);
    expect(omits("launcher-old.desktop")).toBe(true);
  });

  it("reads `?` and `[…]` as globs and everything else literally", () => {
    const omits = omitting(["org.gnome.?ditor.desktop", "kde-[ab]*"]);

    expect(omits("org.gnome.Editor.desktop")).toBe(true);
    expect(omits("orgxgnome.Editor.desktop")).toBe(false);
    expect(omits("kde-b.desktop")).toBe(true);
    expect(omits("kde-c.desktop")).toBe(false);
  });

  it("refuses a pattern with an unclosed class", () => {
    expect(() => omitting(["[ab"])).toThrow("`[ab` is not a glob");
  });
});
