import { showsOneThing } from "./alone";
import type { Screenful } from "./placement";
import type { Rect } from "./rect";
import { barOf } from "./rect";

/** What the commands are pointed at, and where to draw it. */
export type Selection = {
  /**
   * The bar across the top of `rect` the ring rises around: the window's own,
   * or its tab — which leaves the tabs beside it outside the ring. The whole
   * top of a group.
   */
  bar: Rect;
  depth: number;
  /**
   * The window it rings is being dragged, so the ring keeps to it rather than
   * easing after it.
   */
  dragging: boolean;
  /** A container `focus parent` selected, rather than a window. */
  group: boolean;
  rect: Rect;
};

/**
 * What the commands are pointed at: the group `focus parent` selected, or
 * else the window being worked in.
 *
 * **One answer for both**, because they are drawn as one ring: a ring that is
 * the same element whichever it is around eases from a window out to its
 * group and back rather than one line vanishing as another appears.
 *
 * Nothing while a window fills the screen: a line around the screen's edge
 * says nothing the fullscreen window does not already, and a group's is drawn
 * over a window that covers it.
 *
 * Nor while the screen shows one thing alone — see {@link showsOneThing}:
 * there is nothing else the commands could be pointed at, so it would be a
 * line that says nothing.
 */
export const selectionOf = (
  screenful: Screenful,
  activeId: string | undefined,
  fullscreenId: string | undefined,
  draggingId: string | undefined,
): Selection | undefined => {
  const { placements, selection } = screenful;
  const active = placements.find(({ id }) => id === activeId);
  if (fullscreenId !== undefined || showsOneThing(screenful)) {
    return undefined;
  } else if (selection !== undefined) {
    return {
      bar: barOf(selection.rect),
      depth: selection.depth,
      dragging: false,
      group: true,
      rect: selection.rect,
    };
  } else if (active === undefined) {
    return undefined;
  } else {
    return {
      bar: active.bar,
      depth: active.depth,
      dragging: active.id === draggingId,
      group: false,
      rect: active.frame,
    };
  }
};
