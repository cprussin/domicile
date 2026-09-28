// Two floating windows trading places in the stack.
//
// The stack is a `z-index` — see `placedAt` — and a raise is a step of one,
// which the page draws between two frames: the window underneath is simply
// not underneath any more. Nothing moved, so nothing says which of the two
// was reached for. What does is a movement *across* the stack: the one raised
// lifts towards the user as it comes over, and the one it covered sinks back.
//
// Like a close or a workspace switch, nothing announces a raise — the
// reduction that does it leaves the depths as they now are — so it is read off
// the difference between two renders.

import type { Placement } from "./placement";
import { LEAVING, TILED } from "./placement";
import type { Rect } from "./rect";
import type { Shown } from "./shown";

/** A window whose place in the stack has changed against one it overlaps. */
export type Restack = { id: string; motion: "sinking" | "surfacing" };

/**
 * The floating windows that have come over, or gone under, one they overlap
 * since `before`.
 *
 * Surfacing wins for a window that did both: the one that was reached for is
 * the one that comes over *everything* in its way, and every window it passed
 * is sinking under it on its own account.
 *
 * Only between floats. Tiled windows share a depth and never trade places, and
 * a window taking the screen or giving it back is already a movement of its
 * own — a pop on top of a window growing to fill the screen is two at once.
 * Nothing on a workspace switch either, which slides the whole screenful.
 */
export const restacked = (before: Shown, shown: Shown): readonly Restack[] =>
  before.current === shown.current
    ? shown.placements.flatMap((placement) => {
        const was = before.placements.find(({ id }) => id === placement.id);
        const motion =
          was === undefined
            ? undefined
            : restackOf(before, shown, was, placement);
        return motion === undefined ? [] : [{ id: placement.id, motion }];
      })
    : [];

/** Which way `placement` went in the stack, if it went anywhere visible. */
const restackOf = (
  before: Shown,
  shown: Shown,
  was: Placement,
  placement: Placement,
): Restack["motion"] | undefined => {
  const passed = shown.placements.flatMap((other) => {
    const otherWas = before.placements.find(({ id }) => id === other.id);
    return other.id === placement.id ||
      otherWas === undefined ||
      ![was, placement, otherWas, other].every(({ depth }) =>
        isFloating(depth),
      ) ||
      !overlaps(placement.frame, other.frame)
      ? []
      : [
          {
            above: placement.depth > other.depth,
            wasAbove: was.depth > otherWas.depth,
          },
        ];
  });
  if (passed.some(({ above, wasAbove }) => above && !wasAbove)) {
    return "surfacing";
  } else if (passed.some(({ above, wasAbove }) => !above && wasAbove)) {
    return "sinking";
  } else {
    return undefined;
  }
};

/** Over the tiling and under a window on its way out: a float. */
const isFloating = (depth: number): boolean => depth > TILED && depth < LEAVING;

/** Whether the two share any of the screen. */
const overlaps = (one: Rect, other: Rect): boolean =>
  one.x < other.x + other.width &&
  other.x < one.x + one.width &&
  one.y < other.y + other.height &&
  other.y < one.y + one.height;
