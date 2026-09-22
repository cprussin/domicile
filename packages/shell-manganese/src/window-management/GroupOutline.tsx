import { css, cx } from "../../styled-system/css";
import { TILED } from "./placement";
import type { Rect } from "./rect";
import { placedAt, settlingStyles } from "./window-styles";

type Props = {
  /** The box of the container `focus parent` selected. */
  rect: Rect;
};

/**
 * The line around the group the commands are pointed at — sway's indicator.
 *
 * **What `focus parent` does, drawn.** The keys that split, lay out, move and
 * close act on the container rather than on the window the keyboard is in
 * once one is selected, and the desktop otherwise looks exactly as it did:
 * the window's own frame goes on saying where the keyboard is, because that
 * is still where it is. Without this the selection is a mode with nothing on
 * screen to say it is on, which is a desktop the user has to keep in their
 * head.
 *
 * Dashed rather than solid, and a container's box rather than a window's, so
 * that it cannot be read as one more window's edge: a solid accent line is
 * what the window being worked in already draws around itself.
 *
 * **Drawn to be found rather than to be tasteful.** A hairline of accent on
 * a desktop whose every window already draws a line of its own is something
 * you have to go looking for, and a selection you cannot see is the mode it
 * was put there to announce. So it is twice the weight of a window's edge
 * and carries a wash of the same accent inside it, which is what makes the
 * group read as one thing at a glance rather than as four edges that happen
 * to line up.
 *
 * At the depth of the tiling and after every window in the document, which
 * puts it over the windows it rings — their bars, and the client surfaces
 * themselves along all four sides — and under the floats over them. Over a
 * client's own pixels is where a line around a group has to be, because the
 * box it is drawn at is exactly the box those windows fill; it takes no
 * pointer, so a band of accent along their outer edge is the whole of what it
 * costs them, and it is there only while a group is selected.
 */
export const GroupOutline = ({ rect }: Props) => (
  <div
    className={cx(outlineStyles, settlingStyles({ dragging: false }))}
    // The selection, as an attribute as well as a line: the desktop's own
    // state is worth being able to read off the element, in devtools and in a
    // test, rather than only off a hashed class name.
    data-selection
    style={placedAt(rect, TILED)}
  />
);

/**
 * A border rather than an `outline`, so the line falls *inside* the box.
 *
 * The container `focus parent` selects can be the workspace's own, whose edge
 * is the edge of the screen — and a line drawn outside that one is a line
 * drawn off it.
 *
 * And the pointer goes straight through. It covers every window in the group,
 * and the compositor gives the pointer to whatever element is under it, so a
 * line that took the pointer would take it off all of them at once — which is
 * focus-follows-cursor and every client's clicks.
 */
const outlineStyles = css({
  // Twice a window's own edge, off the spacing scale rather than written as
  // a length: a line that has to be found is not the one-pixel edge that
  // STYLING's literal is for.
  border: "{spacing.0.5} dashed {colors.accent}",
  // Rounded at the top and square at the bottom, which is the group's own
  // silhouette: its top two corners are the corners of its topmost windows'
  // bars, which are the only corners the page draws, and its bottom two are
  // where a client's own pixels end squarely — see `TitleBar`.
  borderStartEndRadius: "lg",
  borderStartStartRadius: "lg",
  // The wash, thrown inwards from the line: the group is lit along its own
  // edge rather than tinted all over, because what is inside it is clients'
  // pixels and a sheet of color over those is a desktop seen through glass.
  boxShadow:
    "inset 0 0 {spacing.3} color-mix(in oklab, {colors.accent} 45%, transparent)",
  pointerEvents: "none",
});
