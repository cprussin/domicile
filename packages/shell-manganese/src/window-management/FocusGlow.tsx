import { css, cva, cx } from "../../styled-system/css";
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
  /** The depth of the windows it lights. */
  depth: number;
  /**
   * Whether the focused window is being dragged, which disables easing. See
   * `settlingStyles`.
   */
  dragging: boolean;
  /** Whether focus has left the box, so the glow fades out. */
  leaving: boolean;
  /** The focused window's motion, which the glow plays too. */
  motion: WindowMotion;
  /** The box: the focused window's frame, or its group's. */
  rect: Rect;
  /** The focused window's restack shuffle, if any. */
  restack?: Restack | undefined;
  /** The windows inside the box. */
  windows: readonly string[];
};

/**
 * An accent ring and glow around the window or group commands target.
 *
 * - An outer `box-shadow` only, which is never drawn under its own box, so it
 *   lights the gaps around the box and leaves the client's pixels untouched.
 *   Inside a group it does not light the gaps between the windows.
 * - It sits at the windows' depth before every window in the document, so
 *   windows at that depth cover it and windows above it stay above.
 * - It fades in and out in place instead of moving to the next box.
 * - It plays the focused window's motion and takes no pointer events.
 */
export const FocusGlow = ({
  depth,
  dragging,
  leaving,
  motion,
  rect,
  restack,
  windows,
}: Props) => (
  <div
    className={cx(
      glowStyles,
      fadeStyles({ leaving }),
      movingStyles({ motion }),
      settlingStyles({ box: dragging ? "snapped" : "eased" }),
    )}
    data-focus-box={windows.join(" ")}
    data-leaving={leaving || undefined}
    style={{
      ...placedAt(rect, depth),
      ...scaledAbout(rect, rect),
      ...shuffledBy(restack),
    }}
  />
);

/** Rounded like a window's frame. The ring is 1px, like a window's edge. */
const glowStyles = css({
  borderRadius: "lg",
  boxShadow:
    "0 0 0 1px color-mix(in oklab, {colors.accent} 70%, transparent), 0 0 {spacing.9} color-mix(in oklab, {colors.accent} 45%, transparent), {shadows.lifted}",
  pointerEvents: "none",
});

/** Eased by `settlingStyles`, which carries the `opacity` transition. */
const fadeStyles = cva({
  base: { _starting: { opacity: 0 } },
  variants: {
    leaving: {
      false: { opacity: 1 },
      true: { opacity: 0 },
    },
  },
});
