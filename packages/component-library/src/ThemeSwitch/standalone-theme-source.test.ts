import { describe, expect, it } from "bun:test";

import { standaloneThemeSource } from "./standalone-theme-source";

describe(standaloneThemeSource, () => {
  it("answers its own request, which is what makes a page with no desk usable", () => {
    // The whole of what this stands in for: over a real desk the answer comes
    // back from the compositor, because it has to reach the other monitors and
    // the Wayland clients as well. Here there is nobody else to tell.
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
    // A page with no desk has nothing behind its wipe but itself, so the
    // wipe goes ahead at once.
    await standaloneThemeSource().turnWindows("light");
  });

  it("stops telling a handler that let go", () => {
    // A provider that unmounted while its source outlived it would otherwise
    // keep being told, and would set state on a tree that is gone.
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
