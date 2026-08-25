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
  // No component-library sources: this chrome renders none of its components,
  // because it has no React to render them with — it builds its DOM by hand,
  // and the library is `.tsx`. It takes the preset for its tokens so the
  // desktop is themed like the rest of Domicile.
  include: ["./src/**/*.ts"],
  outdir: "styled-system",
  preflight: true,
  presets: [domicilePreset],
});
