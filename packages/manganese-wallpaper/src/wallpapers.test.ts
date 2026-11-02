import { describe, expect, it } from "bun:test";

import { DEFAULT_WALLPAPERS } from "./photos";
import { wallpapersSchema } from "./wallpapers";

describe("wallpapersSchema", () => {
  it("fills in the built-in photographs for a theme the config leaves out", () => {
    expect(wallpapersSchema.parse(undefined)).toEqual(DEFAULT_WALLPAPERS);
    expect(
      wallpapersSchema.parse({ dark: ["https://example.com/night.jpg"] }),
    ).toEqual({
      dark: ["https://example.com/night.jpg"],
      light: DEFAULT_WALLPAPERS.light,
    });
  });

  it("takes web addresses, and paths from the root or the home", () => {
    const photos = ["https://example.com/night.jpg", "/srv/walls", "~/Walls"];

    expect(wallpapersSchema.parse({ dark: photos }).dark).toEqual(photos);
  });

  it("refuses a photograph that is neither a web address nor a path", () => {
    expect(() => wallpapersSchema.parse({ dark: ["night.jpg"] })).toThrow(
      "an http or https URL, or a path starting with / or ~/",
    );
  });

  it("refuses a theme with no photographs", () => {
    expect(() => wallpapersSchema.parse({ light: [] })).toThrow(
      "at least one photograph",
    );
  });
});
