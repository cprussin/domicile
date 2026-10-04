import { css, cx } from "../../../styled-system/css";
import type { Rect } from "../rect";
import type { Restack } from "../restacking";
import type { WindowMotion } from "../window-motion";
import {
  draggingStyles,
  movingStyles,
  placedAt,
  scaledAbout,
  settlingStyles,
  shuffledBy,
} from "../window-styles";

type Props = {
  /** The stacking depth of the window casting it. */
  depth: number;
  /** Whether the window is being dragged, which makes it translucent. */
  dragging: boolean;
  /** The window's whole box, bar included. */
  frame: Rect;
  /** The window's motion, which the shadow plays too. */
  motion: WindowMotion;
  /** The window's restack animation, if any. */
  restack?: Restack | undefined;
};

/**
 * The shadow a floating window casts.
 *
 * A separate element over the whole frame, since shadows on the bar and the
 * contents separately would overlap each other at the seam.
 *
 * Drawn at the window's depth but before every window in the document, so its
 * window covers it by document order. It animates with the window.
 */
export const FloatShadow = ({
  depth,
  dragging,
  frame,
  motion,
  restack,
}: Props) => (
  <div
    className={cx(
      shadowStyles,
      movingStyles({ motion }),
      dragging && draggingStyles,
      settlingStyles({ dragging }),
    )}
    data-shadow
    style={{
      ...placedAt(frame, depth),
      ...scaledAbout(frame, frame),
      ...shuffledBy(restack),
    }}
  />
);

/**
 * An outer `box-shadow` only, which is never drawn under its own box, so a
 * translucent dragged window shows the desktop, not its shadow. Rounded like
 * the frame, and ignores the pointer.
 */
const shadowStyles = css({
  borderRadius: "lg",
  boxShadow: "lifted",
  pointerEvents: "none",
});
