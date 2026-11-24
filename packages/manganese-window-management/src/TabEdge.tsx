import { cva } from "../styled-system/css";
import type { Rect } from "./rect";
import { contentsScaledAbout, placedAt } from "./window-styles";

type Props = {
  /** The contents' depth. */
  depth: number;
  /** The window's frame. */
  frame: Rect;
  motion: "closing-tab" | "opening-tab";
  /** The contents' box. */
  rect: Rect;
  /** The tab the contents grow out of or shrink into. */
  tab: Rect | undefined;
};

/**
 * The ring and shadow around a tab's contents while they grow out of or
 * shrink into its tab. The contents' own edge scales with them, too thin to
 * show them over a like tab, such as a terminal over a terminal.
 *
 * A layer of its own under the contents, at their depth: it scales with them
 * and fades, so it never comes or goes in one frame, and nothing repaints.
 * `--tab-edge` takes it off where it would spill onto the next display (see
 * `unedgedOn`).
 */
export const TabEdge = ({ depth, frame, motion, rect, tab }: Props) => (
  <div
    aria-hidden
    className={edgeStyles({ motion })}
    data-tab-edge=""
    // Inline because the box is a runtime value Panda cannot extract.
    style={{
      ...placedAt(rect, depth),
      ...contentsScaledAbout(motion, frame, tab, rect),
    }}
  />
);

// Timed as the contents are in `movingStyles`, in the same longhands.
const edgeStyles = cva({
  base: {
    animationFillMode: "both",
    borderEndEndRadius: "lg",
    borderEndStartRadius: "lg",
    boxShadow:
      "var(--tab-edge, 0 0 0 1px {colors.borderStrong}, {shadows.lifted})",
    pointerEvents: "none",
  },
  variants: {
    motion: {
      "closing-tab": {
        animationDelay: "token(durations.fastest)",
        animationDuration: "token(durations.springs.snappy)",
        animationName: "tabEdgeClosing",
        animationTimingFunction: "token(easings.springs.snappy)",
      },
      "opening-tab": {
        animationDuration: "token(durations.springs.smooth)",
        animationName: "tabEdgeOpening",
        animationTimingFunction: "token(easings.springs.smooth)",
      },
    },
  },
});
