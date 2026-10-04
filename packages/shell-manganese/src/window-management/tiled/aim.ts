// Drop zones for dragging a tiled window, as in sway's `tiling_drag`, and the
// corner a tiled resize drags.

import { Direction } from "../direction";
import type { Rect } from "../rect";

/** A tiled window on screen that a dragged one can be dropped on. */
export type Target = {
  frame: Rect;
  id: string;
};

/** What a drop here would do, and where to draw it. */
export type Aim = {
  /** The target's edge, or `undefined` for its middle, which swaps. */
  edge: Direction | undefined;
  id: string;
  /** Where the dragged window would go: half the target, or all of it. */
  rect: Rect;
};

/** The two edges a tiled resize moves. */
export type Corner = {
  horizontal: Direction;
  vertical: Direction;
};

/**
 * How near an edge a drop goes beside the target instead of swapping, as a
 * share of its shorter side. Matches sway.
 */
const EDGE_ZONE = 0.3;

/**
 * What dropping `dragged` at `x`, `y` would do, or `undefined` over no window
 * or over itself.
 */
export const aimAt = (
  targets: readonly Target[],
  dragged: string,
  x: number,
  y: number,
): Aim | undefined => {
  const target = targets.find(({ frame }) => contains(frame, x, y));
  if (target === undefined || target.id === dragged) {
    return undefined;
  } else {
    const edge = edgeNear(target.frame, x, y);
    return {
      edge,
      id: target.id,
      rect: edge === undefined ? target.frame : halfOf(target.frame, edge),
    };
  }
};

/**
 * The corner a resize from `x`, `y` drags: the one in the pointer's quarter,
 * as in sway.
 */
export const cornerOf = (frame: Rect, x: number, y: number): Corner => ({
  horizontal: x > frame.x + frame.width / 2 ? Direction.Right : Direction.Left,
  vertical: y > frame.y + frame.height / 2 ? Direction.Down : Direction.Up,
});

const contains = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x &&
  x < rect.x + rect.width &&
  y >= rect.y &&
  y < rect.y + rect.height;

/** The edge of `rect` nearest the point, if it is inside the edge zone. */
const edgeNear = (rect: Rect, x: number, y: number): Direction | undefined => {
  const distances = [
    { distance: x - rect.x, edge: Direction.Left },
    { distance: rect.x + rect.width - x, edge: Direction.Right },
    { distance: y - rect.y, edge: Direction.Up },
    { distance: rect.y + rect.height - y, edge: Direction.Down },
  ];
  const nearest = distances.reduce((best, next) =>
    next.distance < best.distance ? next : best,
  );
  return nearest.distance > Math.min(rect.width, rect.height) * EDGE_ZONE
    ? undefined
    : nearest.edge;
};

/** The half of `rect` on its `edge` side. */
const halfOf = (rect: Rect, edge: Direction): Rect => {
  switch (edge) {
    case Direction.Left: {
      return { ...rect, width: rect.width / 2 };
    }
    case Direction.Right: {
      return { ...rect, width: rect.width / 2, x: rect.x + rect.width / 2 };
    }
    case Direction.Up: {
      return { ...rect, height: rect.height / 2 };
    }
    case Direction.Down: {
      return { ...rect, height: rect.height / 2, y: rect.y + rect.height / 2 };
    }
  }
};
