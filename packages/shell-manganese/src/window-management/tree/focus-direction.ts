// `focus left` and the other three: which window the keys point at next.
//
// sway's own walk. Start at the container the focus is in and work outwards
// until one of them runs the way the user asked to go, then cross into the
// neighbor on that side — by *its* own focus, so a container is entered at
// whichever window was last used in it rather than at its first.

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
 * Wrapping at the ends of a container, which is what the desktop's config asks
 * for (`focus.wrapping = "yes"`): the focus comes round to the other side of
 * the container it was walking rather than stopping against its edge.
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
 * Whether `focus <direction>` goes off the side of the tiling: nothing lies
 * that way before the focus would wrap, or nothing is tiled at all.
 *
 * Which is where sway goes on to the screen that way, if there is one — it
 * wraps only when there is not.
 */
export const leavesBy = (tiling: Tiling, direction: Direction): boolean => {
  const { root } = tiling;
  return (
    root === undefined ||
    neighboring(root, focusPathOf(root, tiling.depth), direction) === undefined
  );
};

/**
 * The window the focus lands on coming into the tiling from another screen,
 * moving `direction`, or `undefined` when nothing is tiled.
 *
 * sway's: the child on the near edge of a split that runs that way, and the
 * tiling's own focus otherwise — by the window each last had the focus in. A
 * tabbed or stacked tiling keeps the tab it is showing.
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
 * What the focus crosses into, or `undefined` when nothing around it runs that
 * way at all.
 *
 * The candidates in the order sway tries them: the innermost container that
 * runs along the direction and has somewhere to go, then the ones outside it,
 * and last the wrap round the innermost one — so a container with a neighbor
 * two levels up is reached before the focus comes round on itself.
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
 * The child the focus comes round to at the end of a container.
 *
 * `undefined` for a container of one, which has nowhere to wrap to: the focus
 * would land back on the window it started on, and reporting that as a change
 * re-renders the desktop for a keystroke that moved nothing.
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
