// Drop zones for dragging a tiled window, as in sway's `tiling_drag`, and the
// corner a tiled resize drags.

import { Direction } from "../direction";
import type { Rect } from "../rect";
import { sameRect } from "../rect";
import type { TabLayout } from "../tree/frames";
import { Layout } from "../tree/node";

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

/** A tiled window's tab, hidden or open, which a dragged one goes beside. */
export type TabTarget = {
  /** Its index in its strip. */
  at: number;
  id: string;
  rect: Rect;
  /** Its strip's box, which tabs in one strip share. */
  strip: Rect;
  /** The layout of the container whose tab this is. */
  tabbed: TabLayout;
};

/** Everything on every screen a dragged tiled window can be dropped on. */
export type DropTargets = {
  screens: readonly EmptyScreen[];
  tabs: readonly TabTarget[];
  windows: readonly Target[];
};

export enum AimKind {
  Screen,
  Strip,
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
   * Moves along its own strip into tab `id`'s slot, `rect`, on its `edge`
   * side. Moves at once, with no drop indicator.
   */
  Strip: (id: string, edge: Direction, rect: Rect) => ({
    edge,
    id,
    kind: AimKind.Strip as const,
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
 * What dropping the `dragged` windows at `x`, `y` would do, or `undefined` over
 * one of them or over nothing to drop them on. `dragged` is one window, or
 * every window in a dragged group.
 *
 * A window goes before or after the tab under the pointer, by which half of it
 * the pointer is in. A tab over its own strip takes the slot under the pointer.
 * Tabs come before windows, whose frames hold their strips.
 */
export const aimAt = (
  { screens, tabs, windows }: DropTargets,
  dragged: readonly string[],
  x: number,
  y: number,
): Aim | undefined => {
  const tab = tabs.find(({ rect }) => contains(rect, x, y));
  const target = windows.find(({ frame }) => contains(frame, x, y));
  if (tab !== undefined) {
    return dragged.includes(tab.id)
      ? undefined
      : aimAtTab(
          tab,
          tabs.find(({ id }) => dragged.includes(id)),
          x,
          y,
        );
  } else if (target === undefined) {
    const screen = screens.find(({ area }) => contains(area, x, y));
    return screen === undefined
      ? undefined
      : Aim.Screen(screen.name, screen.area);
  } else {
    return dragged.includes(target.id) ? undefined : aimAtWindow(target, x, y);
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

/** Aims at `tab`, along the strip if `dragged` is a tab in the same one. */
const aimAtTab = (
  tab: TabTarget,
  dragged: TabTarget | undefined,
  x: number,
  y: number,
): Aim => {
  const { id, rect, tabbed } = tab;
  if (dragged !== undefined && sameRect(dragged.strip, tab.strip)) {
    return Aim.Strip(id, alongStrip(tabbed, tab.at > dragged.at), rect);
  } else {
    const edge = tabEdgeNear(rect, tabbed, x, y);
    return Aim.Window(id, edge, halfOf(rect, edge));
  }
};

/** The side a tab moving along its strip goes on, by which way it moves. */
const alongStrip = (tabbed: TabLayout, forward: boolean): Direction => {
  switch (tabbed) {
    case Layout.Tabbed: {
      return forward ? Direction.Right : Direction.Left;
    }
    case Layout.Stacking: {
      return forward ? Direction.Down : Direction.Up;
    }
  }
};

/** The end of the tab the point is nearer, along its strip. */
const tabEdgeNear = (
  rect: Rect,
  tabbed: TabLayout,
  x: number,
  y: number,
): Direction => {
  switch (tabbed) {
    case Layout.Tabbed: {
      return x < rect.x + rect.width / 2 ? Direction.Left : Direction.Right;
    }
    case Layout.Stacking: {
      return y < rect.y + rect.height / 2 ? Direction.Up : Direction.Down;
    }
  }
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
