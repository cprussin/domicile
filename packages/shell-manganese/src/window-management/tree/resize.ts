// sway's resize mode for tiled windows: moves share between the focused
// window and its neighbor.

import type { Direction } from "../direction";
import { axisOf as axisOfDirection, isForward } from "../direction";
import { axisOf } from "./node";
import type { Ancestor } from "./path";
import { ancestorsOf, replacedAt } from "./path";
import type { Tiling } from "./tiling";
import { focusPathOf } from "./tiling";

/**
 * The share of a container one resize press moves.
 *
 * sway binds `10 px`, but the tree stores shares, not lengths. 2% is a similar
 * size on a desktop screen.
 */
export const RESIZE_STEP = 0.02;

/**
 * The smallest share a window can have.
 *
 * A window squeezed to nothing has no surface to grab, so it could not be
 * resized back.
 */
export const SMALLEST = 0.05;

/**
 * The tiling with the focused window resized one step in `direction`.
 *
 * Right and down grow it; left and up shrink it, as in sway's resize mode. The
 * resize applies to the nearest ancestor laid out along `direction`'s axis.
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
 * The container's shares with one step moved between the focused child and a
 * neighbor, or `undefined` if that would go below `SMALLEST`.
 *
 * Uses the neighbor ahead in `direction`, or the one behind at the end of the
 * row, so the last window can still grow.
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
