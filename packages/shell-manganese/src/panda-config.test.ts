import { describe, expect, it } from "bun:test";
import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";

import config from "../panda.config";
import { SHADER_EFFECTS } from "./shader-effects/shader-effects";

describe("manganese's panda config", () => {
  it("keeps every global rule of the domicile preset", () => {
    // A selector here replaces the preset's rules for it rather than adding
    // to them. Replacing `html` drops the page's background, so the shell's
    // first frame is white until the wallpaper loads.
    expect(
      Object.keys(config.globalCss ?? {}).filter(
        (selector) => selector in (domicilePreset.globalCss ?? {}),
      ),
    ).toStrictEqual([]);
  });

  // The preset's wipe clips the new theme in along a hard line. With the
  // effect on, it comes in behind a soft edge instead, the same way.
  it("wipes the theme in behind a soft edge while the theme wipe may draw", () => {
    const wipe = (downward: number) => ({
      "0%": {
        filter: `domicile-shader(theme-wipe, 0, ${downward.toString()})`,
      },
      "100%": {
        filter: `domicile-shader(theme-wipe, 1, ${downward.toString()})`,
      },
    });

    expect(config.globalCss).toMatchObject({
      "html[data-theme-flip-to='dark'][data-shader-effects~=theme-wipe]::view-transition-new(root)":
        { animationName: "themeSoftWipeFromTop" },
      "html[data-theme-flip-to='light'][data-shader-effects~=theme-wipe]::view-transition-new(root)":
        { animationName: "themeSoftWipeFromBottom" },
    });
    expect(config.theme?.extend?.keyframes).toStrictEqual({
      themeSoftWipeFromBottom: wipe(0),
      themeSoftWipeFromTop: wipe(1),
    });
  });

  it("passes the theme wipe as many numbers as it takes", () => {
    const uniforms = [
      ...SHADER_EFFECTS["theme-wipe"].sksl.matchAll(/^uniform (\w+) (\w+);$/gm),
    ].map(([, type, name]) => `${type ?? ""} ${name ?? ""}`);

    expect(uniforms).toStrictEqual([
      "shader content",
      "float2 size",
      "float progress",
      "float downward",
    ]);
  });
});
