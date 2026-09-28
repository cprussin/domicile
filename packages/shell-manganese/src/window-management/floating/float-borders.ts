// Where a floating window's edges can be taken hold of without the desktop's
// modifier: a ring around its frame, one strip per edge and a square per
// corner.

import { Direction, isForward } from "../direction";
import type { Rect } from "../rect";
import { GrabCursor } from "../useGrabCursor";
import type { Float, Grip } from "./float";

/**
 * How far into the window a border reaches: enough to find without hunting
 * for it, and little enough to leave the client its own edge pixels.
 */
const INSIDE = 4;

/**
 * How far out past the window a border reaches. A float has no gap beside it
 * to split, so this is what makes the edge easy to find.
 */
const OUTSIDE = 6;

/** How big a corner's square is: bigger than a strip is thick, so it is found. */
const CORNER = 16;

/** Every edge and corner, clockwise from the top-left. */
const GRIPS: readonly Grip[] = [
  { horizontal: Direction.Left, vertical: Direction.Up },
  { horizontal: undefined, vertical: Direction.Up },
  { horizontal: Direction.Right, vertical: Direction.Up },
  { horizontal: Direction.Right, vertical: undefined },
  { horizontal: Direction.Right, vertical: Direction.Down },
  { horizontal: undefined, vertical: Direction.Down },
  { horizontal: Direction.Left, vertical: Direction.Down },
  { horizontal: Direction.Left, vertical: undefined },
];

/** One part of a floating window's ring that dragging resizes it by. */
export type FloatBorder = {
  cursor: GrabCursor;
  grip: Grip;
  rect: Rect;
};

/** The ring of borders around a floating window. */
export const floatBordersOf = (float: Float): readonly FloatBorder[] =>
  GRIPS.map((grip) => {
    const corner = grip.horizontal !== undefined && grip.vertical !== undefined;
    const across = spanOf(float.x, float.width, grip.horizontal, corner);
    const down = spanOf(float.y, float.height, grip.vertical, corner);
    return {
      cursor: cursorOf(grip),
      grip,
      rect: {
        height: down.size,
        width: across.size,
        x: across.start,
        y: down.start,
      },
    };
  });

const cursorOf = ({ horizontal, vertical }: Grip): GrabCursor => {
  if (horizontal === undefined) {
    return GrabCursor.ResizeNs;
  } else if (vertical === undefined) {
    return GrabCursor.ResizeEw;
  } else {
    return isForward(horizontal) === isForward(vertical)
      ? GrabCursor.ResizeNwse
      : GrabCursor.ResizeNesw;
  }
};

/**
 * One axis of a border: where the grip has no `side` on it, the frame's whole
 * length between the corners; else a strip, or a `corner`'s square, over that
 * side.
 */
const spanOf = (
  start: number,
  size: number,
  side: Direction | undefined,
  corner: boolean,
): { size: number; start: number } => {
  const thickness = corner ? CORNER : INSIDE + OUTSIDE;
  if (side === undefined) {
    return {
      size: size + 2 * OUTSIDE - 2 * CORNER,
      start: start - OUTSIDE + CORNER,
    };
  } else {
    return isForward(side)
      ? { size: thickness, start: start + size + OUTSIDE - thickness }
      : { size: thickness, start: start - OUTSIDE };
  }
};
