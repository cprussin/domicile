// A tiled window's edge dragged with the pointer — sway's `floating_modifier`
// resize, on a window in the tree.
//
// Resize mode's arithmetic with the step given by the pointer rather than by a
// key: the edge is the boundary between two children of the container that
// runs the way it moves, and the pointer's pixels are a share of that
// container's box on screen.

import type { Direction } from "../direction";
import { Axis, axisOf as axisOfDirection, isForward } from "../direction";
import type { Rect } from "../rect";
import { areaOf } from "./frames";
import type { Container, LayoutNode } from "./node";
import { axisOf, showsOneChild } from "./node";
import type { Ancestor } from "./path";
import { ancestorsOf, pathTo, replacedAt } from "./path";
import { SMALLEST } from "./resize";
import type { Tiling } from "./tiling";

/**
 * The tiling with the `edge` side of the window `id` moved `by` pixels along
 * its axis — rightwards or downwards where positive, whichever edge it is.
 *
 * `area` and `gap` are what the tiling is laid out in, which is what turns
 * pixels into a share. The same tiling comes back where there is no such edge
 * to move: the window is against that side of the workspace.
 *
 * Throws for a window that is not tiled here: the drag that names it was
 * started on this tiling's own windows.
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
    const along = ancestorsOf(root, path).find((ancestor) =>
      movable(ancestor, edge),
    );
    return along === undefined
      ? tiling
      : { ...tiling, root: withEdgeMoved(root, along, edge, by, area, gap) };
  }
};

/**
 * Whether this container has the edge to move: it lays its children out the
 * way the edge runs, and there is a child past the path on that side.
 *
 * A tabbed or stacking container does not, whichever way it is walked: it
 * shows one child at a time, and its shares are not what sizes anything.
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
 * The boundary after the child `before` moved `share` of the container
 * forwards — never so far that either side of it is left with less than the
 * least a window can have.
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
