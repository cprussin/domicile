import { describe, expect, it } from "bun:test";
import { THEMES } from "@domicile-desktop/component-library/theme-core";

import { WALLPAPER_PHOTOS } from "./photos";

/** Every photograph, whichever theme it is shown in. */
const EVERY_PHOTO = THEMES.flatMap((theme) => WALLPAPER_PHOTOS[theme]);

describe("WALLPAPER_PHOTOS", () => {
  it("is several photographs for each theme, no two of them the same", () => {
    // A rotation needs somewhere to rotate to, and a repeated URL is a minute
    // of the desktop crossfading a photograph into itself — which the shell
    // cannot see, because two layers showing the same picture dissolve
    // perfectly. The titles are what this rests on: one photograph each, for
    // ever, so they are distinct exactly while they are written distinctly.
    //
    // Across the themes as well as within one: a photograph in both would be
    // one that is right for at most one of them.
    for (const theme of THEMES) {
      expect(WALLPAPER_PHOTOS[theme].length).toBeGreaterThan(1);
    }
    expect(new Set(EVERY_PHOTO).size).toBe(EVERY_PHOTO.length);
  });

  it("asks Commons for a named file, encoded, at a width a 4K desktop can use", () => {
    // The whole of what this module buys over a placeholder service: a title
    // names one photograph rather than hashing to one, so the subject is
    // chosen here rather than drawn. The encoding is the part that can break
    // quietly — these titles carry spaces, commas and a typographic
    // apostrophe, and a raw one of those in an `img src` is a URL the
    // browser is left to guess at.
    for (const photo of EVERY_PHOTO) {
      const url = new URL(photo);

      expect(url.origin).toBe("https://commons.wikimedia.org");
      expect(url.pathname).toStartWith("/wiki/Special:FilePath/");
      expect(url.searchParams.get("width")).toBe("3840");
      expect(photo).not.toInclude(" ");
    }
  });
});
