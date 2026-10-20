import { describe, expect, it } from "bun:test";
import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";

import config from "../panda.config";

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
});
