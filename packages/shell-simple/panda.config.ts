import { domicilePreset } from "@domicile/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  exclude: [],
  // Every window is absolutely positioned against the page, so nothing here
  // scrolls and the desktop is the whole viewport.
  globalCss: {
    body: {
      overflow: "hidden",
    },
    "html, body": {
      blockSize: "100%",
    },
  },
  hash: true,
  // No component-library sources: this chrome renders none of its components.
  // It takes the preset for its tokens so the desktop is themed like the rest
  // of Domicile, and draws nothing that a `Button` or an `Input` could be.
  include: ["./src/**/*.ts"],
  outdir: "styled-system",
  preflight: true,
  presets: [domicilePreset],
});
