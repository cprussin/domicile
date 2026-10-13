// Detects floating windows that swapped stacking order, so the page can
// animate the swap.
//
// A `z-index` change alone shows no motion, so the two windows briefly move
// apart, swap depth, and move back. No event announces a raise, so this
// compares two renders.

import type { Placement } from "./placement";
import { LEAVING, TILED } from "./placement";
import type { Rect } from "./rect";
import type { Shown } from "./shown";

/**
 * How far each window moves apart, in desktop pixels.
 *
 * Enough to show the lower edge passing the other, small enough not to look
 * like the window was thrown.
 */
export const SHUFFLE = 48;

/** A window trading places in the stack with one it overlaps. */
export type Restack = {
  /** The offset it moves away from the other window. */
  away: { x: number; y: number };
  /** The old depth, kept until the windows are apart. */
  from: number;
  id: string;
  /** The new depth, taken at the furthest point. */
  to: number;
};

/**
 * Floating windows that swapped order with an overlapping float since
 * `before`, and which way each moves apart.
 *
 * Tiled windows share a depth. Fullscreen changes and workspace switches have
 * their own animations, so they are skipped.
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
 * The first overlapping window that swapped order with `placement`, if any.
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
 * An offset of {@link SHUFFLE} away from the center of `other`, in whole
 * pixels.
 *
 * Windows with the same center part horizontally: the one going over to the
 * left, the other to the right.
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

/** Whether `depth` is a float's: above the tiling, below `LEAVING`. */
const isFloating = (depth: number): boolean => depth > TILED && depth < LEAVING;

/** Whether the two rects overlap. */
const overlaps = (one: Rect, other: Rect): boolean =>
  one.x < other.x + other.width &&
  other.x < one.x + one.width &&
  one.y < other.y + other.height &&
  other.y < one.y + one.height;
