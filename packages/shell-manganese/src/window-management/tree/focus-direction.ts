// `focus left` and the other three: which window the keys point at next.
//
// sway's own walk. Start at the container the focus is in and work outwards
// until one of them runs the way the user asked to go, then cross into the
// neighbour on that side — by *its* own focus, so a container is entered at
// whichever window was last used in it rather than at its first.

import type { Direction } from "../direction";
import { axisOf as axisOfDirection, isForward } from "../direction";
import type { LayoutNode } from "./node";
import { axisOf } from "./node";
import type { Ancestor, Path } from "./path";
import { ancestorsOf, nodeAt } from "./path";
import type { Tiling } from "./tiling";
import { focusedWindowIn, focusPathOf, withFocusOn } from "./tiling";

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
 * What the focus crosses into, or `undefined` when nothing around it runs that
 * way at all.
 *
 * The candidates in the order sway tries them: the innermost container that
 * runs along the direction and has somewhere to go, then the ones outside it,
 * and last the wrap round the innermost one — so a container with a neighbour
 * two levels up is reached before the focus comes round on itself.
 */
const crossing = (
  root: LayoutNode,
  path: Path,
  direction: Direction,
): Path | undefined => {
  const along = ancestorsOf(root, path).filter(
    (ancestor) =>
      axisOf(ancestor.container.layout) === axisOfDirection(direction),
  );
  const tried = [
    ...along.map((ancestor) => into(ancestor, neighbour(ancestor, direction))),
    ...along
      .slice(0, 1)
      .map((ancestor) => into(ancestor, wrapped(ancestor, direction))),
  ];
  return tried.find((candidate) => candidate !== undefined);
};

const into = (
  { path }: Ancestor,
  child: number | undefined,
): Path | undefined => (child === undefined ? undefined : [...path, child]);

/** The child on the `direction` side of the one the focus is in, if any. */
const neighbour = (
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
