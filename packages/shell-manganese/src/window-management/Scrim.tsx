import { cva, cx } from "../../styled-system/css";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import type { WindowMotion } from "./window-motion";
import {
  movingStyles,
  placedAt,
  scaledAbout,
  settlingStyles,
  shuffledBy,
} from "./window-styles";

type Props = {
  /** The covered window's depth. */
  depth: number;
  /** Whether the covered window is unfocused and should be dimmed. */
  dimmed: boolean;
  /**
   * Whether the covered window is being dragged, which disables easing. See
   * `settlingStyles`.
   */
  dragging: boolean;
  /** The covered window's full frame; the transform origin. */
  frame: Rect;
  /** The covered window's motion, which the scrim plays too. */
  motion: WindowMotion;
  /** The covered box: the window's frame, or only its tab. */
  rect: Rect;
  /** The covered window's restack shuffle, if any. */
  restack?: Restack | undefined;
  /** Whether it covers a tab rather than a whole window. */
  tab: boolean;
  /** The covered window, or the window a container's tab is named after. */
  window: string;
};

/**
 * A translucent overlay that dims an unfocused window.
 *
 * - It uses the theme's `background` color rather than black, so it works in
 *   both themes and still dims a dark window in the dark theme.
 * - It is an overlay rather than a filter, so the client's layer is
 *   untouched.
 * - It sits at the window's depth after every window in the document: over
 *   that window and its bar, under floats above it.
 * - It plays the window's motion and takes no pointer events.
 */
export const Scrim = ({
  depth,
  dimmed,
  dragging,
  frame,
  motion,
  rect,
  restack,
  tab,
  window,
}: Props) => (
  <div
    className={cx(
      scrimStyles({ dimmed, tab }),
      movingStyles({ motion }),
      settlingStyles({ dragging }),
    )}
    // Exposes the state on the element for tests and debugging.
    data-dimmed={dimmed || undefined}
    // Not `data-window`: presses on chrome read that to find their window,
    // and the scrim takes no presses.
    data-scrim={window}
    style={{
      ...placedAt(rect, depth),
      ...scaledAbout(frame, rect),
      ...shuffledBy(restack),
    }}
  />
);

const scrimStyles = cva({
  base: {
    borderStartEndRadius: "lg",
    borderStartStartRadius: "lg",
    pointerEvents: "none",
  },
  variants: {
    // Transparent rather than removed, so focus changes ease. See
    // `settlingStyles`.
    dimmed: {
      false: { backgroundColor: "transparent" },
      true: {
        backgroundColor:
          "color-mix(in oklab, {colors.background} 55%, transparent)",
      },
    },
    // Matches the frame's rounded bottom (`bottomCornerStyles`); a tab has
    // square bottom corners.
    tab: {
      false: { borderEndEndRadius: "lg", borderEndStartRadius: "lg" },
      true: {},
    },
  },
});
