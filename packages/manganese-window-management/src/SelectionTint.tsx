import { css } from "../styled-system/css";
import type { BoxOverlayPlacement } from "./BoxOverlay";
import { BoxOverlay } from "./BoxOverlay";

/**
 * Its `depth` is the open tab's, over the windows it tints (see `raised`), and
 * its `rect` the selected container's box (see `FocusBox.selection`).
 */
type Props = BoxOverlayPlacement;

/**
 * An accent wash over the container `focus parent` selected: its tabs, its
 * windows and the gaps between them.
 *
 * - It sits at the open tab's depth after every window and tab in the
 *   document, so it covers them and windows stacked above stay above.
 * - It plays the focused window's motion, moves with its windows, and takes
 *   no pointer events.
 */
export const SelectionTint = (props: Props) => (
  <BoxOverlay {...props} className={tintStyles} data-selection />
);

/** Rounded like a window's frame. Light, so the windows stay readable. */
const tintStyles = css({
  _starting: { opacity: 0 },
  backgroundColor: "color-mix(in oklab, {colors.accent} 15%, transparent)",
  borderRadius: "lg",
  pointerEvents: "none",
});
