// The resize borders around a floating window, usable without the modifier:
// one strip per edge and one square per corner.

import { Direction, isForward } from "../direction";
import type { Rect } from "../rect";
import { GrabCursor } from "../useGrabCursor";
import type { Float, Grip } from "./float";

/**
 * How far a border reaches into the window. Small, so the client keeps its
 * edge pixels.
 */
const INSIDE = 4;

/** How far a border reaches outside the window, to make it easy to hit. */
const OUTSIDE = 6;

/** A corner square's size, larger than a strip's thickness to ease hitting. */
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

/** One resize border of a floating window. */
export type FloatBorder = {
  cursor: GrabCursor;
  grip: Grip;
  rect: Rect;
};

/** All resize borders of a floating window. */
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
 * A border's extent on one axis: the length between the corners when the grip
 * has no `side` on it, otherwise a strip or `corner` square over that side.
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
