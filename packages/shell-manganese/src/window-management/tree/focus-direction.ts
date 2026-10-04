// Directional focus (`focus left` and so on), using sway's algorithm.
//
// Walks out from the focused container to the first one running that way,
// then enters the neighbor at its last-focused window.

import type { Direction } from "../direction";
import { axisOf as axisOfDirection, isForward } from "../direction";
import type { LayoutNode } from "./node";
import { axisOf, NodeKind, showsOneChild } from "./node";
import type { Ancestor, Path } from "./path";
import { ancestorsOf, nodeAt } from "./path";
import type { Tiling } from "./tiling";
import {
  focusedIdOf,
  focusedWindowIn,
  focusPathOf,
  withFocusOn,
} from "./tiling";

/**
 * The tiling with the focus moved one window `direction`.
 *
 * Wraps at a container's ends, per `focus.wrapping = "yes"`.
 */
export const focusMoved = (tiling: Tiling, direction: Direction): Tiling => {
  const { root } = tiling;
  if (root === undefined) {
    return tiling;
  } else {
    const crossed = crossing(root, focusPathOf(root, tiling.depth), direction);
    return crossed === undefined
      ? tiling
      : withFocusOn(tiling, focusedWindowIn(nodeAt(root, crossed)));
  }
};

/**
 * Whether `focus <direction>` leaves the tiling: nothing lies that way before
 * wrapping, or nothing is tiled.
 *
 * Like sway, the caller then moves to the next screen, and wraps only if there
 * is none.
 */
export const leavesBy = (tiling: Tiling, direction: Direction): boolean => {
  const { root } = tiling;
  return (
    root === undefined ||
    neighboring(root, focusPathOf(root, tiling.depth), direction) === undefined
  );
};

/**
 * The window focused when entering the tiling from another screen moving
 * `direction`, or `undefined` when nothing is tiled.
 *
 * As in sway: the near-edge child of a split running that way, else the
 * tiling's own focus. A tabbed or stacked tiling keeps its shown tab.
 */
export const enteredFrom = (
  tiling: Tiling,
  direction: Direction,
): string | undefined => {
  const { root } = tiling;
  if (root === undefined) {
    return undefined;
  } else if (
    root.kind === NodeKind.Container &&
    !showsOneChild(root.layout) &&
    axisOf(root.layout) === axisOfDirection(direction)
  ) {
    const edge = isForward(direction) ? 0 : root.children.length - 1;
    return focusedWindowIn(nodeAt(root, [edge]));
  } else {
    return focusedIdOf(tiling);
  }
};

/**
 * Where the focus moves, or `undefined` if no container runs that way.
 *
 * Tries a neighbor at each level, innermost first, before wrapping the
 * innermost container, as sway does.
 */
const crossing = (
  root: LayoutNode,
  path: Path,
  direction: Direction,
): Path | undefined => {
  const innermost = alongOf(root, path, direction)[0];
  return (
    neighboring(root, path, direction) ??
    (innermost === undefined
      ? undefined
      : into(innermost, wrapped(innermost, direction)))
  );
};

/** Where the focus goes `direction` without wrapping, if anywhere. */
const neighboring = (
  root: LayoutNode,
  path: Path,
  direction: Direction,
): Path | undefined =>
  alongOf(root, path, direction)
    .map((ancestor) => into(ancestor, neighbor(ancestor, direction)))
    .find((candidate) => candidate !== undefined);

/** The containers around `path` that run along `direction`, innermost first. */
const alongOf = (
  root: LayoutNode,
  path: Path,
  direction: Direction,
): readonly Ancestor[] =>
  ancestorsOf(root, path).filter(
    (ancestor) =>
      axisOf(ancestor.container.layout) === axisOfDirection(direction),
  );

const into = (
  { path }: Ancestor,
  child: number | undefined,
): Path | undefined => (child === undefined ? undefined : [...path, child]);

/** The child on the `direction` side of the one the focus is in, if any. */
const neighbor = (
  { container, index }: Ancestor,
  direction: Direction,
): number | undefined => {
  const next = index + (isForward(direction) ? 1 : -1);
  return next >= 0 && next < container.children.length ? next : undefined;
};

/**
 * The child the focus wraps to at a container's end.
 *
 * `undefined` for a single child, so a no-op key press does not re-render.
 */
const wrapped = (
  { container }: Ancestor,
  direction: Direction,
): number | undefined => {
  if (container.children.length < 2) {
    return undefined;
  } else {
    return isForward(direction) ? 0 : container.children.length - 1;
  }
};
