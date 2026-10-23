// Drop zones for dragging a window or its tab, as in sway's `tiling_drag`, and
// the corner a tiled resize drags.

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

/**
 * A tiled or floating window's tab, hidden or open, which a dragged one goes
 * beside.
 */
export type TabTarget = {
  /** Its index in its strip. */
  at: number;
  /** Its window's depth, so the front of two overlapping strips wins. */
  depth: number;
  id: string;
  rect: Rect;
  /** Its strip's box, which tabs in one strip share. */
  strip: Rect;
  /** The layout of the container whose tab this is. */
  tabbed: TabLayout;
};

/** A float's box, which hides every target behind it. */
export type FloatCover = {
  depth: number;
  frame: Rect;
  /** Its windows. A float the drag carries hides nothing. */
  windows: readonly string[];
};

/** Everything on every screen a dragged window can be dropped on. */
export type DropTargets = {
  floats: readonly FloatCover[];
  screens: readonly EmptyScreen[];
  tabs: readonly TabTarget[];
  windows: readonly Target[];
};

export enum AimKind {
  Group,
  Screen,
  Strip,
  Tab,
  Window,
}

/**
 * What a drop here would do. `rect` is where the dragged window would go, for
 * drawing.
 */
export const Aim = {
  /** Goes on the `edge` of the tab group window `id` is in. */
  Group: (id: string, edge: Direction, rect: Rect) => ({
    edge,
    id,
    kind: AimKind.Group as const,
    rect,
  }),
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
   * Goes in tab `id`'s strip, on its `edge` side. `rect` is the line between
   * the two tabs it goes between, and `depth` the depth of the strip.
   */
  Tab: (id: string, edge: Direction, rect: Rect, depth: number) => ({
    depth,
    edge,
    id,
    kind: AimKind.Tab as const,
    rect,
  }),
  /**
   * Goes on window `id`'s `edge`, or into its tab group after it when `edge`
   * is `undefined`.
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
 * How near an edge a drop goes beside the target instead of into its tab
 * group, as a share of its shorter side. Matches sway.
 */
const EDGE_ZONE = 0.3;

/** How thick the line between two tabs is that a new tab is aimed at. */
const TAB_LINE = 4;

/**
 * What dropping the `dragged` windows at `x`, `y` would do, or `undefined` over
 * one of them or over nothing to drop them on. `dragged` is one window, or
 * every window in a dragged group.
 *
 * A window goes before or after the tab under the pointer, by which half of it
 * the pointer is in, or beside the nearest tab anywhere else on its strip. A
 * tab over its own strip takes the slot nearest the pointer, and over its own
 * window goes beside its group. Strips come before windows, whose frames hold
 * them. A float hides what is behind it, but not from a drag that carries it.
 */
export const aimAt = (
  { floats, screens, tabs, windows }: DropTargets,
  dragged: readonly string[],
  x: number,
  y: number,
): Aim | undefined => {
  const cover = coverAt(floats, dragged, x, y);
  const shown = tabs.filter(
    ({ depth }) => cover === undefined || depth >= cover,
  );
  const tab =
    frontOf(shown.filter(({ rect }) => contains(rect, x, y))) ??
    tabNearestOnStrip(shown, x, y);
  const target =
    cover === undefined
      ? windows.find(({ frame }) => contains(frame, x, y))
      : undefined;
  if (tab !== undefined) {
    return dragged.includes(tab.id)
      ? undefined
      : aimAtTab(
          tab,
          tabs.find(({ id }) => dragged.includes(id)),
          x,
          y,
        );
  } else if (cover !== undefined) {
    return undefined;
  } else if (target === undefined) {
    const screen = screens.find(({ area }) => contains(area, x, y));
    return screen === undefined
      ? undefined
      : Aim.Screen(screen.name, screen.area);
  } else if (dragged.includes(target.id)) {
    return aimOutOfGroup(tabs, dragged, target.frame, x, y);
  } else {
    return aimAtWindow(
      target,
      tabs.some(({ id }) => id === target.id),
      x,
      y,
    );
  }
};

/** The front one of `tabs`, by depth. */
const frontOf = (tabs: readonly TabTarget[]): TabTarget | undefined =>
  tabs.reduce<TabTarget | undefined>(
    (front, next) =>
      front === undefined || next.depth > front.depth ? next : front,
    undefined,
  );

/**
 * The tab nearest the point along the front strip under it, or `undefined`
 * off every strip.
 */
const tabNearestOnStrip = (
  tabs: readonly TabTarget[],
  x: number,
  y: number,
): TabTarget | undefined => {
  const front = frontOf(tabs.filter(({ strip }) => contains(strip, x, y)));
  return front === undefined
    ? undefined
    : tabs
        .filter(({ strip }) => sameRect(strip, front.strip))
        .reduce((nearest, next) =>
          distanceAlong(next, x, y) < distanceAlong(nearest, x, y)
            ? next
            : nearest,
        );
};

/** How far the point is from `tab`, along its strip. */
const distanceAlong = (
  { rect, tabbed }: TabTarget,
  x: number,
  y: number,
): number => {
  switch (tabbed) {
    case Layout.Tabbed: {
      return Math.max(rect.x - x, 0, x - rect.x - rect.width);
    }
    case Layout.Stacking: {
      return Math.max(rect.y - y, 0, y - rect.y - rect.height);
    }
  }
};

/**
 * {@link aimAt}, but only beside a tab: what dropping a moved float there
 * would do. Elsewhere the float just moves.
 */
export const tabAimAt = (
  targets: DropTargets,
  dragged: readonly string[],
  x: number,
  y: number,
): Aim | undefined =>
  aimAt({ ...targets, screens: [], windows: [] }, dragged, x, y);

/**
 * The depth of the front float under the point, if any, leaving out a float
 * whose windows are all being dragged.
 */
const coverAt = (
  floats: readonly FloatCover[],
  dragged: readonly string[],
  x: number,
  y: number,
): number | undefined =>
  floats
    .filter(
      ({ frame, windows }) =>
        contains(frame, x, y) && !windows.every((id) => dragged.includes(id)),
    )
    .reduce<number | undefined>(
      (front, { depth }) =>
        front === undefined || depth > front ? depth : front,
      undefined,
    );

/**
 * The corner a resize from `x`, `y` drags: the one in the pointer's quarter,
 * as in sway.
 */
export const cornerOf = (frame: Rect, x: number, y: number): Corner => ({
  horizontal: x > frame.x + frame.width / 2 ? Direction.Right : Direction.Left,
  vertical: y > frame.y + frame.height / 2 ? Direction.Down : Direction.Up,
});

/**
 * Aims at `target`'s edge or middle. The edge of a window with a tab,
 * `tabbed`, is its tab group's, as in sway.
 */
const aimAtWindow = (
  { frame, id }: Target,
  tabbed: boolean,
  x: number,
  y: number,
): Aim => {
  const edge = edgeNear(frame, x, y);
  if (edge === undefined) {
    return Aim.Window(id, edge, frame);
  } else {
    return tabbed
      ? Aim.Group(id, edge, halfOf(frame, edge))
      : Aim.Window(id, edge, halfOf(frame, edge));
  }
};

/**
 * Aims a tab dragged over its own window, `frame`, beside the group it is in,
 * on the half under the pointer. `undefined` for anything else, or a tab with
 * no other tab in its strip.
 *
 * Aims at another tab in the strip, since the dragged one leaves the group.
 */
const aimOutOfGroup = (
  tabs: readonly TabTarget[],
  dragged: readonly string[],
  frame: Rect,
  x: number,
  y: number,
): Aim | undefined => {
  const tab = tabs.find(({ id }) => dragged.includes(id));
  const other =
    tab === undefined
      ? undefined
      : tabs.find(
          ({ id, strip }) =>
            !dragged.includes(id) && sameRect(strip, tab.strip),
        );
  if (other === undefined) {
    return undefined;
  } else {
    const edge = edgeNearest(frame, x, y);
    return Aim.Group(other.id, edge, halfOf(frame, edge));
  }
};

/** Aims at `tab`, along the strip if `dragged` is a tab in the same one. */
const aimAtTab = (
  tab: TabTarget,
  dragged: TabTarget | undefined,
  x: number,
  y: number,
): Aim => {
  const { depth, id, rect, tabbed } = tab;
  if (dragged !== undefined && sameRect(dragged.strip, tab.strip)) {
    return Aim.Strip(id, alongStrip(tabbed, tab.at > dragged.at), rect);
  } else {
    const edge = tabEdgeNear(rect, tabbed, x, y);
    return Aim.Tab(id, edge, lineAt(rect, edge), depth);
  }
};

/** The line along `rect`'s `edge`, centered on it. */
const lineAt = (rect: Rect, edge: Direction): Rect => {
  switch (edge) {
    case Direction.Left: {
      return { ...rect, width: TAB_LINE, x: rect.x - TAB_LINE / 2 };
    }
    case Direction.Right: {
      return {
        ...rect,
        width: TAB_LINE,
        x: rect.x + rect.width - TAB_LINE / 2,
      };
    }
    case Direction.Up: {
      return { ...rect, height: TAB_LINE, y: rect.y - TAB_LINE / 2 };
    }
    case Direction.Down: {
      return {
        ...rect,
        height: TAB_LINE,
        y: rect.y + rect.height - TAB_LINE / 2,
      };
    }
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
  const edge = edgeNearest(rect, x, y);
  return distanceTo(rect, edge, x, y) >
    Math.min(rect.width, rect.height) * EDGE_ZONE
    ? undefined
    : edge;
};

/** The edge of `rect` nearest the point. */
const edgeNearest = (rect: Rect, x: number, y: number): Direction =>
  [Direction.Left, Direction.Right, Direction.Up, Direction.Down].reduce(
    (best, next) =>
      distanceTo(rect, next, x, y) < distanceTo(rect, best, x, y) ? next : best,
  );

/** How far the point is inside `rect` from its `edge`. */
const distanceTo = (
  rect: Rect,
  edge: Direction,
  x: number,
  y: number,
): number => {
  switch (edge) {
    case Direction.Left: {
      return x - rect.x;
    }
    case Direction.Right: {
      return rect.x + rect.width - x;
    }
    case Direction.Up: {
      return y - rect.y;
    }
    case Direction.Down: {
      return rect.y + rect.height - y;
    }
  }
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
