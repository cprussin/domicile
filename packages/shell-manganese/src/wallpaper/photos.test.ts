import { describe, expect, it } from "bun:test";

import { WALLPAPER_PHOTOS } from "./photos";

describe("WALLPAPER_PHOTOS", () => {
  it("is several photographs, no two of them the same", () => {
    // A rotation needs somewhere to rotate to, and a repeated URL is a minute
    // of the desktop crossfading a photograph into itself — which the shell
    // cannot see, because two layers showing the same picture dissolve
    // perfectly. The seeds are what this rests on: one photograph each, for
    // ever, so they are distinct exactly while they are written distinctly.
    expect(WALLPAPER_PHOTOS.length).toBeGreaterThan(1);
    expect(new Set(WALLPAPER_PHOTOS).size).toBe(WALLPAPER_PHOTOS.length);
  });
});
