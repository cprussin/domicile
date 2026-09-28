import { css, cx } from "../../styled-system/css";
import type { Restack } from "./restacking";
import type { Selection } from "./selection";
import type { WindowMotion } from "./window-motion";
import {
  movingStyles,
  placedAt,
  settlingStyles,
  shuffledBy,
} from "./window-styles";

type Props = {
  /**
   * What the window it rings is doing, which it does too while that is a
   * shuffle — the same one of the two, so it starts over when the window does.
   */
  motion?: WindowMotion | undefined;
  /**
   * The window it rings has just opened and is growing in, which the ring
   * does with it — see {@link SelectionRing}.
   */
  opening: boolean;
  /**
   * The shuffle the window it rings is playing, which it plays too — or
   * `undefined` while that window is not shuffling, or it rings a group.
   */
  restack?: Restack | undefined;
  selection: Selection;
};

/**
 * The ring around what the commands are pointed at — sway's indicator.
 *
 * **One ring, whether that is a window or a group.** `focus parent` moves the
 * commands from the window the keyboard is in out to the container around it,
 * and this is the same element either way, so it eases from the one box to
 * the other — see `settlingStyles` — rather than one line vanishing as another
 * appears. Not while its window is dragged, though: a ring easing after each
 * step of a drag trails behind the window it rings. The window's own frame
 * goes on saying where the keyboard is inside a group, because that is still
 * where it is.
 *
 * **Nor around a window that has just opened.** That one grows out of the
 * middle of its own frame, and a ring easing across from the last window to
 * meet it is a second movement beside the first. It is at the new box from the
 * first frame and grows in with the window instead.
 *
 * At the depth of what it rings and after every window in the document, which
 * puts it over that window's bar and the client surface along all four sides
 * — and under the floats over it. It takes no pointer, so a band of accent
 * along the outer edge is the whole of what it costs them.
 */
export const SelectionRing = ({
  motion = "resting",
  opening,
  restack,
  selection,
}: Props) => (
  <div
    className={cx(
      ringStyles,
      opening && movingStyles({ motion: "opening" }),
      restack !== undefined && movingStyles({ motion }),
      settlingStyles({ dragging: selection.dragging || opening }),
    )}
    // What is selected, as an attribute as well as a line: the desktop's own
    // state is worth being able to read off the element, in devtools and in a
    // test, rather than only off a hashed class name.
    data-selection={selection.group ? "group" : "window"}
    style={{
      ...placedAt(selection.rect, selection.depth),
      ...shuffledBy(restack),
    }}
  />
);

/**
 * A border rather than an `outline`, so the line falls *inside* the box.
 *
 * The container `focus parent` selects can be the workspace's own, whose edge
 * is the edge of the screen — and a line drawn outside that one is a line
 * drawn off it. Inside is also where a window's own edge is, so the ring
 * covers that line rather than drawing a second one beside it.
 *
 * And the pointer goes straight through. It covers every window it rings, and
 * the compositor gives the pointer to whatever element is under it, so a ring
 * that took the pointer would take it off all of them at once — which is
 * focus-follows-cursor and every client's clicks.
 */
const ringStyles = css({
  // Solid, and twice a window's own edge, off the spacing scale rather than
  // written as a length: a line that has to be found at a glance is not the
  // one-pixel edge that STYLING's literal is for.
  border: "{spacing.0.5} solid {colors.accent}",
  // Rounded all round, which is a window's own silhouette and a group's: the
  // top corners are the bars' and the bottom ones the windows' own — see
  // `TitleBar` and `bottomCornerStyles`.
  borderRadius: "lg",
  pointerEvents: "none",
});
