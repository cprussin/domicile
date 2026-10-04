import { describe, expect, it } from "bun:test";

import { standaloneThemeSource } from "./standalone-theme-source";

describe(standaloneThemeSource, () => {
  it("answers its own request, which is what makes a page with no desk usable", () => {
    // With a compositor, the answer comes from the compositor instead.
    const source = standaloneThemeSource();
    const told: unknown[] = [];
    source.onTheme((theme) => {
      told.push(theme);
    });

    source.setTheme("light");

    expect(told).toStrictEqual(["light"]);
    expect(source.theme).toBe("light");
  });

  it("starts dark, which is what a page with nothing to ask paints in", () => {
    expect(standaloneThemeSource().theme).toBe("dark");
  });

  it("has no windows to wait for", async () => {
    await standaloneThemeSource().turnWindows("light");
  });

  it("stops telling a handler that let go", () => {
    // Otherwise an unmounted provider would set state on a dead tree.
    const source = standaloneThemeSource();
    const told: unknown[] = [];
    const stop = source.onTheme((theme) => {
      told.push(theme);
    });

    stop();
    source.setTheme("light");

    expect(told).toStrictEqual([]);
  });
});
