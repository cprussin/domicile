import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

// A float swapping depth with one it overlaps: it moves apart, swaps depth at
// the furthest point, and moves back. See `shuffledBy` and `restacking.ts`.
//
// The new depth is set at 51% so it lands right after the furthest point.
// Interpolated from 50% to 100%, it would change too late, after the windows
// overlap again.
//
// Defined once and registered under two names; see `nextShuffle`.
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

// A side-to-side shake that dies down.
const LOCK_REFUSED = {
  "0%, 100%": { transform: "translateX(0)" },
  "15%": { transform: "translateX(calc(-1 * {spacing.3}))" },
  "35%": { transform: "translateX({spacing.2.5})" },
  "55%": { transform: "translateX(calc(-1 * {spacing.1.5}))" },
  "75%": { transform: "translateX({spacing.1})" },
};

export default defineConfig({
  exclude: [],
  // The desktop never scrolls. It spans every display, so it is wider than the
  // viewport. `overflow: hidden` would still be a scroll container: focusing
  // something off screen would scroll it, and every position taken from
  // `getBoundingClientRect` would be off by that offset. `clip` is not a
  // scroll container.
  globalCss: {
    html: {
      overflow: "clip",
      // Shell chrome is not selectable text. Set at the root so new chrome is
      // covered too. Window pages are separate documents and are unaffected.
      userSelect: "none",
    },
    "html, body, #root": {
      blockSize: "100%",
    },
    // Fields stay selectable so they can be edited.
    "input, textarea": {
      userSelect: "text",
    },
  },
  // Registered as a length so it can ease; see `stripStyles` in `TitleBar`.
  // Inherited, since the slot's `::after` reads it.
  globalVars: {
    "--strip-rest": {
      inherits: true,
      initialValue: "0px",
      syntax: "<length>",
    },
  },
  hash: true,
  // The shell renders component-library controls, so it must scan their
  // source to emit their CSS rules. Hashing is deterministic per preset, so the
  // library's runtime class names match the rules generated here.
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
        // The bar's bell on a new notification. Runs once per arrival, not
        // on a loop, since the toast already shows the notification.
        bellRing: {
          "0%": { transform: "rotate(0)" },
          "15%": { transform: "rotate(14deg)" },
          "30%": { transform: "rotate(-12deg)" },
          "45%": { transform: "rotate(8deg)" },
          "60%": { transform: "rotate(-5deg)" },
          "75%": { transform: "rotate(2deg)" },
          "100%": { transform: "rotate(0)" },
        },
        // A nearly empty battery. Unlike the preset's `pulse`, it returns to
        // full opacity each cycle so the readout stays legible.
        //
        // Animates opacity, not color, so the `danger` token alone sets the
        // color and one animation covers the whole readout.
        chargeFlashing: {
          "0%": { opacity: "1" },
          "50%": { opacity: "{opacity.pulseMin}" },
          "100%": { opacity: "1" },
        },
        // A bar of the launcher's now-playing meter. Each bar has its own
        // offset.
        equalizer: {
          "0%": { transform: "scaleY(0.3)" },
          "100%": { transform: "scaleY(1)" },
        },
        // The lock screen shakes on a rejected passphrase. Registered under
        // two names so a second rejection restarts it; see `shaken` in
        // `lock/Lock.tsx`.
        lockRefused: LOCK_REFUSED,
        lockRefusedAgain: LOCK_REFUSED,
        // A workspace switch slides every window on the workspace by one
        // screen width (`--workspace-width`; see `slidAcross`). The arriving
        // workspace starts where the leaving one ends, so they never overlap
        // and nothing needs to fade.
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
        // The reverse of `windowOpening`. It shrinks only to 0.85 rather than
        // to nothing; the fade does most of the work.
        windowClosing: {
          "0%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.85)" },
        },
        // A closing tab collapses along its strip: `--collapse-x` in a tabbed
        // container, `--collapse-y` in a stack; see `collapsedAlong`.
        //
        // A visible tab's contents get neither and only fade, since the next
        // tab is drawn underneath at the same box (see `windowUncovering`).
        windowClosingTab: {
          "0%": { opacity: "1", transform: "scale(1, 1)" },
          "100%": {
            opacity: "0",
            transform: "scale(var(--collapse-x, 1), var(--collapse-y, 1))",
          },
        },
        // A tab switch: the revealed tab fades in over the hidden one; see
        // `tab-switch.ts`.
        //
        // Both hold a fixed depth throughout (see `placement.ts`). Otherwise
        // `settlingStyles` would transition the depths and the swap would
        // happen halfway, hiding the fade.
        windowConcealing: {
          "0%": { zIndex: "-1" },
          "100%": { zIndex: "-1" },
        },
        // The workspace being left slides out by one screen width.
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
        // A window opening fades and scales up to its laid-out box.
        //
        // Uses a transform, not the box size: an `<app>`'s box sets its
        // client's configured size, so resizing it would make the client
        // redraw every frame.
        //
        // The bar and contents are separate elements, so each gets an inline
        // `transform-origin` at the frame's center; see `scaledAbout`.
        windowOpening: {
          "0%": { opacity: "0", transform: "scale(0.85)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        // The reverse of `windowClosingTab`: a new tab opens out along its
        // strip, and its contents only fade in over the tab they replace.
        windowOpeningTab: {
          "0%": {
            opacity: "0",
            transform: "scale(var(--collapse-x, 1), var(--collapse-y, 1))",
          },
          "100%": { opacity: "1", transform: "scale(1, 1)" },
        },
        windowRestacking: RESTACKING,
        windowRestackingAgain: RESTACKING,
        windowRevealing: {
          "0%": { opacity: "0", zIndex: "0" },
          "100%": { opacity: "1", zIndex: "0" },
        },
        // The tab a close uncovers holds the tiled depth while the closed tab
        // fades over it. Otherwise `settlingStyles` would ease its depth up
        // from the hidden tabs', and one of them would show through.
        windowUncovering: {
          "0%": { zIndex: "0" },
          "100%": { zIndex: "0" },
        },
        // The zoom indicator: appears quickly, holds long enough to read, then
        // fades out on its own.
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
          // How long a self-dismissing notice stays up, such as the zoom
          // indicator. Longer than the preset's durations, which are for
          // control feedback, not reading.
          notice: { value: "1.5s" },
        },
        easings: {
          // For long movements such as the workspace switch (see
          // `movingStyles`). `outQuart` starts at full speed, which looks like
          // a jump over a screen's width.
          emphasized: { value: "cubic-bezier(0.2, 0, 0, 1)" },
        },
      },
    },
  },
});
