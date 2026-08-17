import { domicilePreset } from "@domicile/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  exclude: [],
  // The chrome is the whole viewport and nothing in it scrolls the page: the
  // rail and the stage divide the height between them, and a window fills the
  // stage. That has to be said on the elements React does not render.
  globalCss: {
    body: {
      overflow: "hidden",
    },
    "html, body, #root": {
      blockSize: "100%",
    },
  },
  hash: true,
  // The shell is the composition root: it renders its own chrome and every
  // component-library control that chrome uses, so the CSS rules for all of
  // their `css`/recipe calls must be emitted here. Panda's `css()` only
  // produces class names; the build that scans a call's source is what emits
  // the matching rule. Hashing is deterministic for a given preset, so the
  // class names the library's own `styled-system` produces at runtime line up
  // with the rules generated here.
  include: [
    "./src/**/*.{ts,tsx}",
    "../../packages/component-library/src/**/*.{ts,tsx}",
  ],
  jsxFramework: "react",
  outdir: "styled-system",
  preflight: true,
  presets: [domicilePreset],
});
