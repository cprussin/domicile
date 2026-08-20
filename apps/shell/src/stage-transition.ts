// DEMO BRANCH — not for merge. How a window arrives on the stage and leaves it.
//
// Shared by both kinds of window, which is the point: `AppWindow` is a
// `<domicile-app>` the compositor draws from a client's own buffer, and
// `BrowserWindow` is an ordinary section the engine paints. A transition on
// only one of them looks like a bug rather than a style — the arriving window
// glides and the leaving one vanishes — which is exactly how it looked when
// only `AppWindow` had this.
//
// `hidden` is what takes a window off the stage in the real shell, and it
// cannot be what does it here: a `display: none` element has no box to
// transition from and no box to report, so the portal would be gone from the
// scene before the first frame of the animation. Every window stays laid out
// instead, and the ones off the stage are faded and slid.
//
// What that costs, and why it is a demo: every window is measured on every
// animation frame rather than only the one on screen, and a `<webview>` off
// the stage goes on rendering a page nobody is looking at.

import { css } from "../styled-system/css";

const stageTransition = {
  // Long enough to read as a movement rather than a jump. The first version of
  // this was 320ms on `cubic-bezier(0.2, 0, 0, 1)`, which spends about 90% of
  // its travel in the first third — nominally a third of a second, and it
  // looked like a snap with a long invisible tail.
  transitionDuration: "380ms",
  transitionProperty: "opacity, translate",
  // The standard ease: quick to commit, gentle to settle, and no long tail.
  transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

/** On the stage: opaque, in place, and taking the pointer. */
export const onStageClass = css({
  ...stageTransition,
  opacity: 1,
  pointerEvents: "auto",
  translate: "0 0",
  zIndex: 1,
});

/**
 * Off the stage: faded, slid aside, and taking no pointer.
 *
 * `pointer-events` is load-bearing rather than decorative. The compositor
 * routes a click by hit-testing a window's rectangle, and an off-stage window
 * still has one — so without this an invisible window under the stage wins
 * every click meant for what is on it. Worse, the click that hands the
 * keyboard back to the chrome is one the chrome has to *receive*, so it
 * swallows the way out too and nothing on the stage can be clicked again.
 * `<domicile-app>` reports this with its placement and the compositor passes
 * such a window over.
 *
 * `translate` rather than `transform`, deliberately: the SDK leaves
 * `translate` out of the matrix it sends because the position is already in
 * the element's box. So this exercises the path where the compositor follows a
 * window purely by re-reading where the browser put it, which is the path a
 * CSS transition on any layout property takes.
 */
export const offStageClass = css({
  ...stageTransition,
  opacity: 0,
  pointerEvents: "none",
  translate: "-6% 0",
  zIndex: 0,
});
