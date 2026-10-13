import { describe, expect, it } from "bun:test";
import { THEMES } from "@domicile-desktop/component-library/theme-core";

import { WALLPAPER_PHOTOS } from "./photos";

/** Every photograph across all themes. */
const EVERY_PHOTO = THEMES.flatMap((theme) => WALLPAPER_PHOTOS[theme]);

describe("WALLPAPER_PHOTOS", () => {
  it("is several photographs for each theme, no two of them the same", () => {
    // A repeated URL would crossfade a photograph into itself, which looks
    // like no change. Unique across themes too, since a photograph suits only
    // one theme.
    for (const theme of THEMES) {
      expect(WALLPAPER_PHOTOS[theme].length).toBeGreaterThan(1);
    }
    expect(new Set(EVERY_PHOTO).size).toBe(EVERY_PHOTO.length);
  });

  it("asks Commons for a named file, encoded, at a width a 4K desktop can use", () => {
    // Titles contain spaces, commas and a typographic apostrophe, which must
    // be encoded to form a valid `img src`.
    for (const photo of EVERY_PHOTO) {
      const url = new URL(photo);

      expect(url.origin).toBe("https://commons.wikimedia.org");
      expect(url.pathname).toStartWith("/wiki/Special:FilePath/");
      expect(url.searchParams.get("width")).toBe("3840");
      expect(photo).not.toInclude(" ");
    }
  });
});
