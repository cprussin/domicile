// sway's resize mode, on a tiled window: its share of the container it is in,
// taken from or given to the window beside it.

import type { Direction } from "../direction";
import { axisOf as axisOfDirection, isForward } from "../direction";
import { axisOf } from "./node";
import type { Ancestor } from "./path";
import { ancestorsOf, replacedAt } from "./path";
import type { Tiling } from "./tiling";
import { focusPathOf } from "./tiling";

/**
 * How much of a container one press moves.
 *
 * sway's own bindings say `10 px`, which this cannot mean: a tiled window's
 * size here is a share of its container rather than a length, and the shares
 * are what the tree holds. A fiftieth of the container is the same order of
 * size on a desktop-sized screen and is one press either way to undo.
 */
export const RESIZE_STEP = 0.02;

/**
 * The smallest share a window can be left with.
 *
 * Not a taste: a window squeezed to nothing has no title bar to grab and no
 * surface to point at, so it cannot be resized back.
 */
const SMALLEST = 0.05;

/**
 * The tiling with the focused window grown or shrunk one step `direction`.
 *
 * Right and down grow it, left and up shrink it — which is what sway's resize
 * mode binds to `l`/`j` and `h`/`k`. The container that runs the way the user
 * asked is the one that gives: a window in a column cannot be made wider by
 * itself, so the ask climbs to the row the column is in.
 */
export const resized = (tiling: Tiling, direction: Direction): Tiling => {
  const { root } = tiling;
  if (root === undefined) {
    return tiling;
  } else {
    const along = ancestorsOf(root, focusPathOf(root, tiling.depth)).find(
      (ancestor) =>
        axisOf(ancestor.container.layout) === axisOfDirection(direction) &&
        ancestor.container.children.length > 1,
    );
    const fractions =
      along === undefined ? undefined : shared(along, direction);
    if (along === undefined || fractions === undefined) {
      return tiling;
    } else {
      return {
        ...tiling,
        root: replacedAt(root, along.path, () => ({
          ...along.container,
          fractions,
        })),
      };
    }
  }
};

/**
 * The container's shares with one step moved between the focused child and its
 * neighbour, or `undefined` when that would squeeze one of them out.
 *
 * The neighbour is the one on the side being resized towards, and the one
 * *behind* where there is nothing ahead: a window at the end of a row still
 * grows when it is asked to, by taking from what is before it.
 */
const shared = (
  { container, index }: Ancestor,
  direction: Direction,
): readonly number[] | undefined => {
  const ahead = index + (isForward(direction) ? 1 : -1);
  const behind = index + (isForward(direction) ? -1 : 1);
  const from = container.fractions[ahead] === undefined ? behind : ahead;
  const grows = isForward(direction) ? index : from;
  const shrinks = isForward(direction) ? from : index;
  const grown = container.fractions[grows];
  const shrunk = container.fractions[shrinks];
  // Nothing to move where there is no neighbour to move it with, and nothing
  // to take from a window that has the least a window can have.
  if (
    grown === undefined ||
    shrunk === undefined ||
    shrunk - RESIZE_STEP < SMALLEST
  ) {
    return undefined;
  } else {
    return container.fractions.map((fraction, at) => {
      switch (at) {
        case grows: {
          return grown + RESIZE_STEP;
        }
        case shrinks: {
          return shrunk - RESIZE_STEP;
        }
        default: {
          return fraction;
        }
      }
    });
  }
};
