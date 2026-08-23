import { domicilePreset } from "@domicile/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  exclude: [],
  // The page is the desktop and nothing in it scrolls: the rail and the stage
  // divide a screen's height between them, and a window fills the stage. That
  // has to be said on the elements React does not render.
  //
  // `clip` rather than `hidden`, and on the root rather than the body, because
  // the desktop is not the viewport: it spans every display, so it is wider
  // than a window showing one of them. A `hidden` viewport is still a scroll
  // container — focusing something off to the right scrolls it, with no bar to
  // show for it — and everything the shell places is placed from a
  // `getBoundingClientRect`, which is viewport-relative and so is off by the
  // scroll offset from then on. That puts every portal somewhere the user is
  // not looking, and the chrome that placed it there looks correct. A clipped
  // box is not a scroll container at all.
  globalCss: {
    html: {
      overflow: "clip",
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
