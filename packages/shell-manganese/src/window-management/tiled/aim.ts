// Drop zones for dragging a tiled window, as in sway's `tiling_drag`, and the
// corner a tiled resize drags.

import { Direction } from "../direction";
import type { Rect } from "../rect";

/** A tiled window on screen that a dragged one can be dropped on. */
export type Target = {
  frame: Rect;
  id: string;
};

/** A screen with nothing tiled on it, which a dragged window fills. */
export type EmptyScreen = {
  /** Its workspace's box. */
  area: Rect;
  name: string;
};

/** Everything on every screen a dragged tiled window can be dropped on. */
export type DropTargets = {
  screens: readonly EmptyScreen[];
  windows: readonly Target[];
};

export enum AimKind {
  Screen,
  Window,
}

/**
 * What a drop here would do. `rect` is where the dragged window would go, for
 * drawing.
 */
export const Aim = {
  /** Fills the empty screen `name`. */
  Screen: (name: string, rect: Rect) => ({
    kind: AimKind.Screen as const,
    name,
    rect,
  }),
  /**
   * Goes on window `id`'s `edge`, or swaps with it when `edge` is `undefined`.
   */
  Window: (id: string, edge: Direction | undefined, rect: Rect) => ({
    edge,
    id,
    kind: AimKind.Window as const,
    rect,
  }),
};

export type Aim = ReturnType<(typeof Aim)[keyof typeof Aim]>;

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
 * What dropping `dragged` at `x`, `y` would do, or `undefined` over itself or
 * over nothing to drop it on.
 */
export const aimAt = (
  { screens, windows }: DropTargets,
  dragged: string,
  x: number,
  y: number,
): Aim | undefined => {
  const target = windows.find(({ frame }) => contains(frame, x, y));
  if (target === undefined) {
    const screen = screens.find(({ area }) => contains(area, x, y));
    return screen === undefined
      ? undefined
      : Aim.Screen(screen.name, screen.area);
  } else {
    return target.id === dragged ? undefined : aimAtWindow(target, x, y);
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

const aimAtWindow = ({ frame, id }: Target, x: number, y: number): Aim => {
  const edge = edgeNear(frame, x, y);
  return Aim.Window(id, edge, edge === undefined ? frame : halfOf(frame, edge));
};

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
