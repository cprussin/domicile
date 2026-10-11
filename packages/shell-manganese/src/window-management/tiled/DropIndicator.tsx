import { css } from "../../../styled-system/css";
import { TILED } from "../placement";
import type { Rect } from "../rect";
import { placedAt } from "../window-styles";

type Props = {
  /** Where the dragged window would land if dropped now. */
  rect: Rect;
};

/**
 * Shows where a dragged tiled window would land, like sway's drop indicator.
 *
 * Nothing retiles until the drop, so this is the only preview. It is drawn
 * after every window at the tiling's depth and ignores the pointer.
 */
export const DropIndicator = ({ rect }: Props) => (
  <div className={indicatorStyles} data-drop style={placedAt(rect, TILED)} />
);

const indicatorStyles = css({
  background: "color-mix(in oklab, {colors.accent} 30%, transparent)",
  border: "{spacing.0.5} solid {colors.accent}",
  borderRadius: "lg",
  pointerEvents: "none",
  // An overlay no client draws into, so its box can ease.
  transition:
    "inline-size {durations.fast} {easings.out}, block-size {durations.fast} {easings.out}, inset-block-start {durations.fast} {easings.out}, inset-inline-start {durations.fast} {easings.out}",
});
