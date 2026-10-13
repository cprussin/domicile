// Pointer resize of a tiled window's edge (sway's `floating_modifier` drag).
// Converts the drag in pixels to a share of the container the edge divides.

import {
  Axis,
  axisOf as axisOfDirection,
  Direction,
  isForward,
} from "../direction";
import type { Rect } from "../rect";
import { areaOf } from "./frames";
import type { Container, LayoutNode } from "./node";
import { axisOf, showsOneChild } from "./node";
import type { Ancestor } from "./path";
import { ancestorsOf, pathTo, replacedAt } from "./path";
import { SMALLEST } from "./resize";
import type { Tiling } from "./tiling";

/**
 * The tiling with the `edge` side of window `id` moved `by` pixels (positive is
 * right or down).
 *
 * An `edge` on the workspace's edge can't move, so the opposite edge moves
 * instead, the same way. `area` and `gap` are the tiling's layout box, used to
 * convert pixels to a share. Returns `tiling` unchanged when neither edge can
 * move. Throws if `id` is not tiled here.
 */
export const stretched = (
  tiling: Tiling,
  id: string,
  edge: Direction,
  by: number,
  area: Rect,
  gap: number,
): Tiling => {
  const { root } = tiling;
  const path = root === undefined ? undefined : pathTo(root, id);
  if (root === undefined || path === undefined) {
    throw new Error(`layout tree: no tiled window ${id} to stretch`);
  } else {
    const ancestors = ancestorsOf(root, path);
    const boundary =
      boundaryOf(ancestors, edge) ?? boundaryOf(ancestors, oppositeOf(edge));
    return boundary === undefined
      ? tiling
      : {
          ...tiling,
          root: withEdgeMoved(
            root,
            boundary.along,
            boundary.edge,
            by,
            area,
            gap,
          ),
        };
  }
};

/** The nearest ancestor whose boundary on `edge`'s side can move, if any. */
const boundaryOf = (
  ancestors: readonly Ancestor[],
  edge: Direction,
): { along: Ancestor; edge: Direction } | undefined => {
  const along = ancestors.find((ancestor) => movable(ancestor, edge));
  return along === undefined ? undefined : { along, edge };
};

/**
 * Whether this container splits along `edge`'s axis and has a child beyond the
 * path on that side.
 *
 * Tabbed and stacking containers never qualify: their shares size nothing.
 */
const movable = ({ container, index }: Ancestor, edge: Direction): boolean =>
  !showsOneChild(container.layout) &&
  axisOf(container.layout) === axisOfDirection(edge) &&
  container.children[index + (isForward(edge) ? 1 : -1)] !== undefined;

/** The tree with the boundary on the `edge` side of `along`'s child moved. */
const withEdgeMoved = (
  root: LayoutNode,
  { container, index, path }: Ancestor,
  edge: Direction,
  by: number,
  area: Rect,
  gap: number,
): LayoutNode => {
  const box = areaOf(root, path, area, gap);
  const length =
    axisOfDirection(edge) === Axis.Horizontal ? box.width : box.height;
  const extent = length - gap * (container.children.length - 1);
  const before = isForward(edge) ? index : index - 1;
  return replacedAt(root, path, () =>
    withBoundaryMoved(container, before, by / extent),
  );
};

/**
 * The container with the boundary after child `before` moved forward by
 * `share`, clamped so neither side goes below `SMALLEST`.
 */
const withBoundaryMoved = (
  container: Container,
  before: number,
  share: number,
): Container => {
  const first = shareOf(container, before);
  const second = shareOf(container, before + 1);
  const moved = Math.min(Math.max(share, SMALLEST - first), second - SMALLEST);
  return {
    ...container,
    fractions: container.fractions.map((fraction, at) => {
      switch (at) {
        case before: {
          return fraction + moved;
        }
        case before + 1: {
          return fraction - moved;
        }
        default: {
          return fraction;
        }
      }
    }),
  };
};

const shareOf = (container: Container, at: number): number => {
  const fraction = container.fractions[at];
  if (fraction === undefined) {
    throw new Error(`layout tree: no share for child ${at.toString()}`);
  } else {
    return fraction;
  }
};

/** The edge across the window from `edge`. */
const oppositeOf = (edge: Direction): Direction => {
  switch (edge) {
    case Direction.Left: {
      return Direction.Right;
    }
    case Direction.Right: {
      return Direction.Left;
    }
    case Direction.Up: {
      return Direction.Down;
    }
    case Direction.Down: {
      return Direction.Up;
    }
  }
};
