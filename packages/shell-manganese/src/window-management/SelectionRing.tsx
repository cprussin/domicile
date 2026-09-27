import { css, cx } from "../../styled-system/css";
import type { Selection } from "./selection";
import { placedAt, settlingStyles } from "./window-styles";

type Props = {
  selection: Selection;
};

/**
 * The ring around what the commands are pointed at — sway's indicator.
 *
 * **One ring, whether that is a window or a group.** `focus parent` moves the
 * commands from the window the keyboard is in out to the container around it,
 * and this is the same element either way, so it eases from the one box to
 * the other — see `settlingStyles` — rather than one line vanishing as another
 * appears. The window's own frame goes on saying where the keyboard is inside
 * a group, because that is still where it is.
 *
 * At the depth of what it rings and after every window in the document, which
 * puts it over that window's bar and the client surface along all four sides
 * — and under the floats over it. It takes no pointer, so a band of accent
 * along the outer edge is the whole of what it costs them.
 */
export const SelectionRing = ({ selection }: Props) => (
  <div
    className={cx(ringStyles, settlingStyles({ dragging: false }))}
    // What is selected, as an attribute as well as a line: the desktop's own
    // state is worth being able to read off the element, in devtools and in a
    // test, rather than only off a hashed class name.
    data-selection={selection.group ? "group" : "window"}
    style={placedAt(selection.rect, selection.depth)}
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
