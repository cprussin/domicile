import { css, cx } from "../../../styled-system/css";
import { TILED } from "../placement";
import type { Rect } from "../rect";
import { placedAt, settlingStyles } from "../window-styles";

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
  <div
    className={cx(indicatorStyles, settlingStyles({ box: "eased" }))}
    data-drop
    style={placedAt(rect, TILED)}
  />
);

const indicatorStyles = css({
  background: "color-mix(in oklab, {colors.accent} 30%, transparent)",
  border: "{spacing.0.5} solid {colors.accent}",
  borderRadius: "lg",
  pointerEvents: "none",
});
