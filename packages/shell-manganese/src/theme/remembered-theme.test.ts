import { beforeEach, describe, expect, it } from "bun:test";

import { rememberedTheme, rememberTheme } from "./remembered-theme";

const THEME_KEY = "theme:v2";

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("the theme this page paints in before the desk has said", () => {
  it("is nothing at all on a machine that has not seen one", () => {
    // Not a default: the caller picks the fallback, and "never seen" must stay
    // distinct from "last seen dark".
    expect(rememberedTheme()).toBeUndefined();
  });

  it("is the theme the desk was last seen in", () => {
    rememberTheme("light");
    expect(rememberedTheme()).toBe("light");
  });

  it("ignores a value that is not a theme", () => {
    // Anything can be stored under the key, so an unknown value returns
    // `undefined`.
    globalThis.localStorage.setItem(THEME_KEY, "system");
    expect(rememberedTheme()).toBeUndefined();
  });
});
