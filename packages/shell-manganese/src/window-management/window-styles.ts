import type { CSSProperties } from "react";

import { css, cva } from "../../styled-system/css";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import type { TabLayout } from "./tree/frames";
import { Layout } from "./tree/node";

/**
 * Styles shared by every window.
 *
 * No background: a client surface's element is a hole the compositor draws
 * into, and a background would cover it.
 *
 * No `display`: atomic classes tie on specificity, so this would race the
 * window's own `display`. Fixed positioning already blockifies the box.
 */
export const windowStyles = css({
  // Outranks a window's own `display`, which would beat the UA `hidden` rule.
  "&[hidden]": { display: "none" },
});

/**
 * Inline style placing part of a window at `rect` and stacking it at `depth`.
 *
 * Inline because Panda only extracts build-time literals. `depth` must be the
 * element's own `z-index`, since that is what stacks the client's surface.
 * Coordinates are the desktop's: the viewport spans every display.
 */
export const placedAt = (rect: Rect, depth: number): CSSProperties => ({
  blockSize: `${rect.height.toString()}px`,
  inlineSize: `${rect.width.toString()}px`,
  insetBlockStart: `${rect.y.toString()}px`,
  insetInlineStart: `${rect.x.toString()}px`,
  position: "fixed",
  zIndex: depth,
});

/**
 * The border that makes a window's edge visible. Focus is shown by `FocusGlow`,
 * not by this border's color.
 */
// Longhands, not `border`: the frame overrides one side, and a shorthand and
// longhand on one element race on Panda's emit order.
export const edgeStyles = css({
  borderColor: "borderStrong",
  borderStyle: "solid",
  borderWidth: "1px",
});

/**
 * Rounds a window's bottom corners; its bar rounds the top ones.
 *
 * Set on the `<app>` itself because `border-radius` on a layer also clips the
 * client's pixels. See `docs/architecture/WINDOW-COMPOSITING.md`.
 */
export const bottomCornerStyles = css({
  borderEndEndRadius: "lg",
  borderEndStartRadius: "lg",
});

/**
 * Lets the pointer pass through a window to the page, so the shell can handle
 * drags while the modifier is held.
 */
export const clickThroughStyles = css({ pointerEvents: "none" });

/**
 * Inline style setting part of a window's `transform-origin` to the center of
 * its whole `frame`.
 *
 * The bar and contents are separate elements; scaling both about one point
 * keeps them together. Pointer mapping is unaffected: the engine maps a
 * pointer through the `<app>`'s whole transform, origin included.
 */
export const scaledAbout = (frame: Rect, rect: Rect): CSSProperties => ({
  transformOrigin: `${(frame.x + frame.width / 2 - rect.x).toString()}px ${(frame.y + frame.height / 2 - rect.y).toString()}px`,
});

/**
 * Custom properties for the `windowRestacking` keyframes, or none when the
 * window is not restacking.
 *
 * The depths go through the animation so `z-index` changes when the windows
 * are furthest apart.
 */
export const shuffledBy = (
  restack: Restack | undefined,
): Record<`--${string}`, number | string> =>
  restack === undefined
    ? {}
    : {
        "--restack-from": restack.from,
        "--restack-to": restack.to,
        "--restack-x": `${restack.away.x.toString()}px`,
        "--restack-y": `${restack.away.y.toString()}px`,
      };

/**
 * Custom property for the `windowClosingTab` and `windowOpeningTab` keyframes:
 * which axis a tab collapses along. None for a bar that is not a tab.
 *
 * Set on the bar only; without it the keyframes just fade (see
 * `panda.config.ts`).
 */
export const collapsedAlong = (
  tabbed: TabLayout | undefined,
): Record<`--${string}`, number> => {
  switch (tabbed) {
    case Layout.Stacking: {
      return { "--collapse-y": 0 };
    }
    case Layout.Tabbed: {
      return { "--collapse-x": 0 };
    }
    case undefined: {
      return {};
    }
  }
};

/**
 * Custom properties for the keyframes that slide a window off its `screen`,
 * set on a wrapper and inherited by each part of the window:
 *
 * - `--workspace-width`: the screen width, so the two workspaces of a switch
 *   stay side by side.
 * - `--lift`: how far up `frame` must move to clear the screen's top edge, for
 *   the scratchpad's slides. None for a window not drawn.
 */
export const slidAcross = (
  screen: Rect,
  frame: Rect | undefined,
): Record<`--${string}`, string> => ({
  "--workspace-width": `${screen.width.toString()}px`,
  ...(frame === undefined
    ? {}
    : { "--lift": `${(frame.y + frame.height - screen.y).toString()}px` }),
});

/**
 * A window's animation, keyed by `WindowMotion`. Keyframes are in
 * `panda.config.ts`.
 *
 * All are transforms and opacity, so the client never redraws. Opening and
 * closing use `durations.fast` to match {@link settlingStyles}, so a window
 * and its neighbors move together. Both use `outQuart`, front-loading the
 * motion; an ease-in close at this length looks like the window sits still,
 * then vanishes. Departures use `forwards` so the window does not snap back
 * before it is removed.
 */
export const movingStyles = cva({
  variants: {
    motion: {
      // Both workspaces share timing so they stay side by side. `emphasized`,
      // not `outQuart`: a full-screen slide that starts at full speed jumps.
      "arriving-from-end": {
        animation:
          "windowArrivingFromEnd {durations.slower} {easings.emphasized}",
      },
      "arriving-from-start": {
        animation:
          "windowArrivingFromStart {durations.slower} {easings.emphasized}",
      },
      closing: {
        animation: "windowClosing {durations.fast} {easings.outQuart} forwards",
      },
      // Same curve as {@link settlingStyles}, so neighboring tabs move with it.
      "closing-tab": {
        animation: "windowClosingTab {durations.fast} {easings.out} forwards",
      },
      // The tab being hidden; lasts as long as `revealing` so it stays under.
      concealing: {
        animation: "windowConcealing {durations.fast} {easings.in-out}",
      },
      // The scratchpad's slides take `slowest` and avoid front-loaded curves,
      // so a slide of up to a screen's height is seen: `out` settles the
      // window into place, and `in` starts its exit where it can be seen.
      dropping: {
        animation: "windowDropping {durations.slowest} {easings.out}",
      },
      "leaving-to-end": {
        animation:
          "windowLeavingToEnd {durations.slower} {easings.emphasized} forwards",
      },
      "leaving-to-start": {
        animation:
          "windowLeavingToStart {durations.slower} {easings.emphasized} forwards",
      },
      opening: {
        animation: "windowOpening {durations.fast} {easings.outQuart}",
      },
      // The reverse of `closing-tab`, on the same curve as its neighbors.
      "opening-tab": {
        animation: "windowOpeningTab {durations.fast} {easings.out}",
      },
      // Overlapping floats separate, swap depths, and rejoin. Parameters come
      // from {@link shuffledBy}. `in-out` pauses them where they swap.
      restacking: {
        animation: "windowRestacking {durations.slower} {easings.in-out}",
      },
      // A second name so an immediate repeat restarts the animation.
      "restacking-again": {
        animation: "windowRestackingAgain {durations.slower} {easings.in-out}",
      },
      resting: {},
      // Fades in over the hidden tab in the same box, giving a crossfade.
      revealing: {
        animation: "windowRevealing {durations.fast} {easings.in-out}",
      },
      // Slower than `closing` and on an even curve, so the window is seen
      // leaving rather than vanishing. It draws over the windows moving into
      // its space, so it need not keep pace with them.
      sending: {
        animation:
          "windowSending {durations.slowest} {easings.in-out} forwards",
      },
      // A tab leaves its strip as it does when closed.
      "sending-tab": {
        animation: "windowClosingTab {durations.fast} {easings.out} forwards",
      },
      stowing: {
        animation: "windowStowing {durations.slowest} {easings.in} forwards",
      },
      // Lasts as long as `closing-tab`, which it is drawn under.
      uncovering: {
        animation: "windowUncovering {durations.fast} {easings.out}",
      },
    },
  },
});

/**
 * Transitions that ease a window between layouts instead of snapping.
 *
 * - Box: animates size and inset, not a transform, so the client is
 *   configured at each intermediate size. Off while dragging, or the window
 *   would trail the pointer.
 * - Depth: `z-index` eases with the box, so a window leaving fullscreen stays
 *   above the windows it still covers until it has shrunk (see
 *   `placement.ts`).
 * - Colors: always eased; focus follows the pointer, so snapping would
 *   flicker.
 * - Opacity: always eased, so `FocusGlow` fades rather than blinks.
 * - Strip rest: eases with the box, so the end of a tab strip stays put while
 *   its last tab moves (see `stripStyles` in `TitleBar`).
 *
 * One recipe because two rules setting `transition` on one element race on
 * Panda's emit order.
 */
export const settlingStyles = cva({
  variants: {
    dragging: {
      false: {
        transition:
          "inline-size {durations.fast} {easings.out}, block-size {durations.fast} {easings.out}, inset-block-start {durations.fast} {easings.out}, inset-inline-start {durations.fast} {easings.out}, z-index {durations.fast} {easings.out}, background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}, opacity {durations.fast} {easings.out}, --strip-rest {durations.fast} {easings.out}",
      },
      true: {
        transition:
          "z-index {durations.fast} {easings.out}, background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}, opacity {durations.fast} {easings.out}",
      },
    },
  },
});
