import { domicilePreset } from "@domicile/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

// A float trading places with one it overlaps: it parts from the other,
// trades depths with it at the furthest point, and comes back. See
// `shuffledBy` for the custom properties, and `restacking.ts` for why a
// shuffle.
//
// The new depth is written at 51% as well as at the end, so it lands in the
// frame after the furthest point: left to interpolate from 50% to 100%, a step
// of one would round over three quarters of the way back, with the two windows
// already on top of each other again.
//
// Above the config because it is used twice, under two names — see
// `nextShuffle`.
const RESTACKING = {
  "0%": {
    transform: "translate(0, 0)",
    zIndex: "var(--restack-from)",
  },
  "50%": {
    transform: "translate(var(--restack-x), var(--restack-y))",
    zIndex: "var(--restack-from)",
  },
  "51%": { zIndex: "var(--restack-to)" },
  "100%": {
    transform: "translate(0, 0)",
    zIndex: "var(--restack-to)",
  },
};

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
      // And none of it is text to select: the shell is a desktop rather than
      // a document, so a drag across the bar or a title that paints a
      // selection is a drag that went wrong. Said once at the root rather than
      // on each piece of chrome, so a piece added later is covered without
      // anybody remembering. A window's page is its own document, so this
      // does not reach it.
      userSelect: "none",
    },
    "html, body, #root": {
      blockSize: "100%",
    },
    // A field is the exception: what is in it is what somebody typed, and
    // selecting it is how it is edited.
    "input, textarea": {
      userSelect: "text",
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
        // The charge, once there is almost none: the readout is drawn at full
        // strength twice a turn rather than dimmed throughout, which is the
        // difference between this and the preset's `pulse`. `pulse` sits
        // between a third and two thirds and says a control is busy; a battery
        // with minutes left has to be *more* legible than the rest of the bar
        // at the moment it is least ignorable, not less.
        //
        // Opacity rather than a color, so the one decision about what red is
        // stays the `danger` token's, and so the flash reaches the whole
        // readout — the case, the fill, the bolt and the figures — which is
        // four elements and one animation.
        chargeFlashing: {
          "0%": { opacity: "1" },
          "50%": { opacity: "{opacity.pulseMin}" },
          "100%": { opacity: "1" },
        },
        // A workspace slides in from the side it was on, and it is the whole
        // workspace that moves: every window on it goes the same distance, so
        // they arrive together rather than scatter.
        //
        // A screen's width, which is `--workspace-width` — see `slidAcross`.
        // The two workspaces are side by side in the row, so the one arriving
        // starts exactly where the one leaving ends up: the screen is a window
        // onto a strip that moves under it, and nothing needs to fade to hide
        // the two drawn through each other, because they never are. What
        // goes past the edge is off the page — every page on a tty is one
        // screen.
        windowArrivingFromEnd: {
          "0%": { transform: "translateX(var(--workspace-width))" },
          "100%": { transform: "translateX(0)" },
        },
        windowArrivingFromStart: {
          "0%": {
            transform: "translateX(calc(-1 * var(--workspace-width)))",
          },
          "100%": { transform: "translateX(0)" },
        },
        // A window leaving: the reverse of the arrival below, and the same
        // length, so closing one reads as the undoing of opening it.
        //
        // It ends at the size it started arriving from rather than at nothing.
        // A window that shrank to a point would spend most of the animation as
        // a speck nobody is looking at; what says "gone" is the fade, and the
        // scale is what makes the fade a movement rather than a dissolve.
        windowClosing: {
          "0%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.85)" },
        },
        // And the workspace being left goes the other way, a screen's width
        // too, so it is pushed off by the one coming on.
        windowLeavingToEnd: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(var(--workspace-width))" },
        },
        windowLeavingToStart: {
          "0%": { transform: "translateX(0)" },
          "100%": {
            transform: "translateX(calc(-1 * var(--workspace-width)))",
          },
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
        //
        // About the middle of the window's whole frame, which is not a thing a
        // keyframe can say: the bar and the contents are separate elements at
        // different boxes, so the point they share is written on each of them
        // as an inline `transform-origin`. See `scaledAbout`.
        windowOpening: {
          "0%": { opacity: "0", transform: "scale(0.85)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        windowRestacking: RESTACKING,
        windowRestackingAgain: RESTACKING,
        // A browser window's zoom, said for a moment and put away: in quickly
        // enough to answer the key that asked, held long enough to be read,
        // and out without anybody dismissing it.
        zoomAnnounced: {
          "0%": {
            opacity: "0",
            transform: "translateY(calc(-1 * {spacing.1}))",
          },
          "10%": { opacity: "1", transform: "translateY(0)" },
          "75%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
      },
      tokens: {
        durations: {
          // How long a notice that nobody dismisses stays up — the zoom
          // indicator's whole life. Far longer than the preset's scale, which
          // measures how long a control takes to answer rather than how long
          // a sentence takes to read.
          notice: { value: "1.5s" },
        },
        easings: {
          // A long movement: eased into rather than started at full speed,
          // then a long settle. `outQuart` starts at speed, which over a
          // screen's width is a jump in the first frame rather than a slide —
          // see the workspace switch in `movingStyles`.
          emphasized: { value: "cubic-bezier(0.2, 0, 0, 1)" },
        },
      },
    },
  },
});
