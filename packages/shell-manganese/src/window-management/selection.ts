import type { Screenful } from "./placement";
import { TILED } from "./placement";
import type { Rect } from "./rect";

/** What the commands are pointed at, and where to draw it. */
export type Selection = {
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
 */
export const selectionOf = (
  { placements, selection }: Screenful,
  activeId: string | undefined,
  fullscreenId: string | undefined,
  draggingId: string | undefined,
): Selection | undefined => {
  const active = placements.find(({ id }) => id === activeId);
  if (fullscreenId !== undefined) {
    return undefined;
  } else if (selection !== undefined) {
    return { depth: TILED, dragging: false, group: true, rect: selection };
  } else if (active === undefined) {
    return undefined;
  } else {
    return {
      depth: active.depth,
      dragging: active.id === draggingId,
      group: false,
      rect: active.frame,
    };
  }
};
