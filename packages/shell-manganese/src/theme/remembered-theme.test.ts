import { beforeEach, describe, expect, it } from "bun:test";

import { rememberedTheme, rememberTheme } from "./remembered-theme";

const THEME_KEY = "theme:v2";

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("the theme this page paints in before the desk has said", () => {
  it("is nothing at all on a machine that has not seen one", () => {
    // Not `dark`, which is what a page with no guess ends up painting: that
    // decision belongs to whoever is applying a theme, and answering it here
    // would make "the desk was last seen dark" and "I have never seen this
    // desk" the same value.
    expect(rememberedTheme()).toBeUndefined();
  });

  it("is the theme the desk was last seen in", () => {
    rememberTheme("light");
    expect(rememberedTheme()).toBe("light");
  });

  it("ignores a value that is not a theme", () => {
    // Anything at all can be under that key, including this shell's own
    // `theme:v1`, whose values were a three-valued preference with `system` in
    // it. A word this build cannot place is a guess it cannot make.
    globalThis.localStorage.setItem(THEME_KEY, "system");
    expect(rememberedTheme()).toBeUndefined();
  });
});
