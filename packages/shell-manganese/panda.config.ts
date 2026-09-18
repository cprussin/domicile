import { domicilePreset } from "@domicile/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  exclude: [],
  // The page is the desktop and nothing in it scrolls: every window is placed
  // at a rectangle worked out from the screen it is on. That has to be said on
  // the elements React does not render.
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
  theme: {
    extend: {
      keyframes: {
        // A window leaving: the reverse of the arrival above, and the same
        // length, so closing one reads as the undoing of opening it.
        //
        // It ends at the size it started arriving from rather than at nothing.
        // A window that shrank to a point would spend most of the animation as
        // a speck nobody is looking at; what says "gone" is the fade, and the
        // scale is what makes the fade a movement rather than a dissolve.
        windowClosing: {
          "0%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.94)" },
        },
        // A window arriving: up from nothing, and out to the box the layout
        // has already given it.
        //
        // A transform rather than the box itself, and that is the whole reason
        // a window can be animated at all. The size of an `<app>` is the
        // resolution its client is configured at — the SDK reports the box and
        // the compositor sends the client a `configure` — so a window that
        // grew by *laying out* smaller would make the client redraw on every
        // frame of it. A transform leaves the box alone: the page's own
        // compositor scales the layer the client's buffer is already in, which
        // is what the engine fork bought.
        windowOpening: {
          "0%": { opacity: "0", transform: "scale(0.94)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
    },
  },
});
