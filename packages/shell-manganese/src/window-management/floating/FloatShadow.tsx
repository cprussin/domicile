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
  /** How it stacks, which is the depth of the window it is cast by. */
  depth: number;
  /** Whether the user has hold of that window, which makes it see-through. */
  dragging: boolean;
  /** The whole box that window's bar and contents span. */
  frame: Rect;
  /** What that window is doing, which its shadow does with it. */
  motion: WindowMotion;
  /** And the shuffle it plays with it, if it is playing one. */
  restack?: Restack | undefined;
};

/**
 * The shadow a floating window casts on whatever is under it.
 *
 * **Its own element rather than a `box-shadow` on the window's two.** A window
 * is a bar over its contents, and each of them casting a shadow of its own
 * throws the bar's across the top of the client's pixels and the contents'
 * up beside the bar: two shadows, and a seam drawn between them. One element
 * over the whole frame casts one.
 *
 * At the window's own depth and before every window in the document, so the
 * window it belongs to covers it on document order — the tie `Stage` settles
 * the same way for a window's bar — and every window under that one is under
 * its shadow too.
 *
 * It moves as the window does: the same motion about the same point, the same
 * see-through while it is dragged, and the same easing between boxes.
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
 * A shadow with nothing inside it: an outer `box-shadow` is never drawn under
 * its own box, so a window dragged see-through shows the desktop behind it
 * rather than its own shadow.
 *
 * Rounded where the frame is — its bar at the top, its contents at the bottom —
 * so the shadow's silhouette is the window's. And the pointer goes straight through: the window covers the
 * box, and a shadow is not something to click.
 */
const shadowStyles = css({
  borderRadius: "lg",
  boxShadow: "lifted",
  pointerEvents: "none",
});
