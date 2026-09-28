// Two floating windows trading places in the stack.
//
// The stack is a `z-index` — see `placedAt` — and a raise is a step of one,
// which the page draws between two frames: the window underneath is simply
// not underneath any more, and nothing says which of the two moved. What does
// is a shuffle, the way two cards are: the pair part, trade places in the
// stack while they are apart, and come back together the other way up. The
// one raised is seen to come out from under the other and go over it.
//
// Like a close or a workspace switch, nothing announces a raise — the
// reduction that does it leaves the depths as they now are — so it is read off
// the difference between two renders.

import type { Placement } from "./placement";
import { LEAVING, TILED } from "./placement";
import type { Rect } from "./rect";
import type { Shown } from "./shown";

/**
 * How far each of the two parts from the other, in the desktop's pixels.
 *
 * Far enough that the edge of the one underneath is seen to come out past the
 * other and go back over it; no further, because the whole of a window going
 * somewhere and coming back reads as a window being thrown about.
 */
export const SHUFFLE = 48;

/** A window trading places in the stack with one it overlaps. */
export type Restack = {
  /** Which way it parts from the other, and how far. */
  away: { x: number; y: number };
  /** The depth it had, which it keeps until the two are apart. */
  from: number;
  id: string;
  /** And the depth it has now, which it takes at the furthest point. */
  to: number;
};

/**
 * The floating windows that have come over, or gone under, one they overlap
 * since `before`, and which way each parts from the window it passed.
 *
 * Only between floats. Tiled windows share a depth and never trade places, and
 * a window taking the screen or giving it back is already a movement of its
 * own. Nothing on a workspace switch either, which slides the whole screenful.
 */
export const restacked = (before: Shown, shown: Shown): readonly Restack[] =>
  before.current === shown.current
    ? shown.placements.flatMap((placement) => {
        const was = before.placements.find(({ id }) => id === placement.id);
        const passed =
          was === undefined
            ? undefined
            : passedBy(before, shown, was, placement);
        return was === undefined || passed === undefined
          ? []
          : [
              {
                away: awayFrom(
                  placement.frame,
                  passed.frame,
                  placement.depth > passed.depth,
                ),
                from: was.depth,
                id: placement.id,
                to: placement.depth,
              },
            ];
      })
    : [];

/**
 * The first window `placement` has changed places with in the stack and
 * overlaps, which is the one it parts from — or `undefined` for none.
 */
const passedBy = (
  before: Shown,
  shown: Shown,
  was: Placement,
  placement: Placement,
): Placement | undefined =>
  shown.placements.find((other) => {
    const otherWas = before.placements.find(({ id }) => id === other.id);
    return (
      other.id !== placement.id &&
      otherWas !== undefined &&
      [was, placement, otherWas, other].every(({ depth }) =>
        isFloating(depth),
      ) &&
      overlaps(placement.frame, other.frame) &&
      placement.depth > other.depth !== was.depth > otherWas.depth
    );
  });

/**
 * {@link SHUFFLE} straight away from the middle of `other`, in whole pixels.
 *
 * Two windows sharing a middle have no side to part towards, so they part
 * along the row: the one going over to the start, the other to the end.
 */
const awayFrom = (
  rect: Rect,
  other: Rect,
  goingOver: boolean,
): Restack["away"] => {
  const x = rect.x + rect.width / 2 - (other.x + other.width / 2);
  const y = rect.y + rect.height / 2 - (other.y + other.height / 2);
  const length = Math.hypot(x, y);
  return length === 0
    ? { x: goingOver ? -SHUFFLE : SHUFFLE, y: 0 }
    : {
        // `+ 0` so a movement of nothing is `0` rather than `-0`.
        x: Math.round((x / length) * SHUFFLE) + 0,
        y: Math.round((y / length) * SHUFFLE) + 0,
      };
};

/** Over the tiling and under a window on its way out: a float. */
const isFloating = (depth: number): boolean => depth > TILED && depth < LEAVING;

/** Whether the two share any of the screen. */
const overlaps = (one: Rect, other: Rect): boolean =>
  one.x < other.x + other.width &&
  other.x < one.x + one.width &&
  one.y < other.y + other.height &&
  other.y < one.y + one.height;
