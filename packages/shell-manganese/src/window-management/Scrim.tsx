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
  /** How it stacks: the depth of the window it is over. */
  depth: number;
  /** Whether the window it is over is one the commands are not pointed at. */
  dimmed: boolean;
  /**
   * Whether the user has hold of the window it is over, so it takes each box
   * outright rather than easing after it — see `settlingStyles`.
   */
  dragging: boolean;
  /** The whole box of the window it is over, which it turns about. */
  frame: Rect;
  /** What the window it is over is doing, which it does with it. */
  motion: WindowMotion;
  /** What it covers: the window's whole frame, or its tab alone. */
  rect: Rect;
  /** The shuffle the window it is over is playing, if it is. */
  restack?: Restack | undefined;
  /** Whether it covers a tab rather than a whole window. */
  tab: boolean;
  /** The window it is over, or the one a container's tab is named after. */
  window: string;
};

/**
 * A wash of the page's own ground over a window the commands are not pointed
 * at, which is how the desktop says where they are: every other window
 * recedes, rather than a line being drawn around the one that does not.
 *
 * **The ground rather than black**, so it reads the same way in either theme:
 * darker in the dark one and paler in the light one — and a dark window in the
 * dark theme, which a filter's `brightness` barely moves, still sinks.
 *
 * **Over the window rather than a filter on it**, so the client's own pixels
 * are composited untouched and nothing about the window's layer changes.
 *
 * At the depth of the window it covers and after every window in the
 * document, which puts it over that window and its bar — and under the floats
 * over it. It moves as that window does, since a scrim left standing while
 * its window slid away would be a gray box on the desk. It takes no pointer,
 * so the window under it is reached straight through it.
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
    // Whether it is washing its window, as an attribute as well as a color:
    // the desktop's own state is worth being able to read off the element.
    data-dimmed={dimmed || undefined}
    // Which window it is over, for the same reason. Not `data-window`, which
    // is what a press on the chrome reads to find the window it reached for —
    // and nothing presses this.
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
    // Faded rather than taken away, so the focus moving eases — see
    // `settlingStyles`, which eases `background-color`.
    dimmed: {
      false: { backgroundColor: "transparent" },
      true: {
        backgroundColor:
          "color-mix(in oklab, {colors.background} 55%, transparent)",
      },
    },
    // Rounded at the bottom as a window's frame is — see
    // `bottomCornerStyles` — but square under a tab, as the tab is.
    tab: {
      false: { borderEndEndRadius: "lg", borderEndStartRadius: "lg" },
      true: {},
    },
  },
});
