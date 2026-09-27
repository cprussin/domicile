import { css, cx } from "../../../styled-system/css";
import { TILED } from "../placement";
import type { Rect } from "../rect";
import { placedAt, settlingStyles } from "../window-styles";

type Props = {
  /** Where the window being dragged would go if it were let go of now. */
  rect: Rect;
};

/**
 * Where a tiled window being dragged would land — sway's drop indicator.
 *
 * A move retiles nothing until it is let go of, so without this the user is
 * dropping blind: half of a window says it goes beside it, the whole of one
 * says the two trade places. It eases between boxes as the pointer crosses
 * them rather than jumping.
 *
 * Drawn the way `SelectionRing` is and for its reasons — after every window, at
 * the tiling's depth, taking no pointer.
 */
export const DropIndicator = ({ rect }: Props) => (
  <div
    className={cx(indicatorStyles, settlingStyles({ dragging: false }))}
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
