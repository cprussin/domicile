// Dropping a dragged tiled window onto another, as in sway's `tiling_drag`.
//
// Dropping on the middle swaps the two. Dropping on an edge puts the window on
// that side: in the target's container if it runs that way, else in a new
// split with the target.

import type { Direction } from "../direction";
import { axisOf as axisOfDirection, isForward } from "../direction";
import type { LayoutNode } from "./node";
import {
  axisOf,
  LayoutNode as Node,
  NodeKind,
  splitFor,
  withChildAt,
} from "./node";
import type { Path } from "./path";
import { nodeAt, pathTo, replacedAt } from "./path";
import { withoutAt } from "./remove";
import type { Tiling } from "./tiling";
import { withFocusOn } from "./tiling";

/**
 * The tiling with window `id` dropped on `target`'s `edge`, or its middle when
 * `edge` is `undefined`, with focus on the moved window.
 *
 * Throws if either window is not tiled here.
 */
export const droppedOn = (
  tiling: Tiling,
  id: string,
  target: string,
  edge: Direction | undefined,
): Tiling => {
  if (id === target) {
    return tiling;
  } else {
    const root = tiledRoot(tiling);
    const moved =
      edge === undefined
        ? traded(root, id, target)
        : besideTarget(root, id, target, edge);
    return withFocusOn({ ...tiling, root: moved }, id);
  }
};

/**
 * The tiling with window `id`, dragged in from another workspace, dropped on
 * `target`'s `edge`, or in its place when `edge` is `undefined`. Focuses `id`.
 *
 * Throws if `target` is not tiled here.
 */
export const arrivedOn = (
  tiling: Tiling,
  id: string,
  target: string,
  edge: Direction | undefined,
): Tiling => {
  const root = tiledRoot(tiling);
  const at = pathOf(root, target);
  const moved =
    edge === undefined
      ? replacedAt(root, at, () => Node.Window(id))
      : placedBeside(root, at, Node.Window(id), edge);
  return withFocusOn({ ...tiling, root: moved }, id);
};

/**
 * The tiling with window `id` replaced by `by`, the window it was dropped on
 * in the middle of on another workspace.
 *
 * Throws if `id` is not tiled here.
 */
export const tradedFor = (tiling: Tiling, id: string, by: string): Tiling => {
  const root = tiledRoot(tiling);
  return {
    ...tiling,
    root: replacedAt(root, pathOf(root, id), () => Node.Window(by)),
  };
};

/** Swaps the two windows, keeping both boxes' sizes. */
const traded = (root: LayoutNode, id: string, target: string): LayoutNode => {
  const from = pathOf(root, id);
  const to = pathOf(root, target);
  return replacedAt(
    replacedAt(root, from, () => Node.Window(target)),
    to,
    () => Node.Window(id),
  );
};

/**
 * Removes window `id` and puts it on the `edge` side of `target`.
 *
 * Removes it first, like a keyed `move`, so the tree collapses as after a
 * close before the target is located.
 */
const besideTarget = (
  root: LayoutNode,
  id: string,
  target: string,
  edge: Direction,
): LayoutNode => {
  const rest = withoutAt(root, pathOf(root, id));
  if (rest === undefined) {
    // Unreachable: the target is still in the tree.
    throw new Error(`layout tree: dropping ${id} left nothing to drop it on`);
  } else {
    return placedBeside(rest, pathOf(rest, target), Node.Window(id), edge);
  }
};

/**
 * Puts `moving` on the `edge` side of the node at `at`: in its parent if the
 * parent runs along that axis, else in a new split with the node (also when
 * there is no parent).
 */
const placedBeside = (
  root: LayoutNode,
  at: Path,
  moving: LayoutNode,
  edge: Direction,
): LayoutNode => {
  const index = at.at(-1);
  const around = at.slice(0, -1);
  const parent = index === undefined ? undefined : nodeAt(root, around);
  const axis = axisOfDirection(edge);
  const forward = isForward(edge);
  if (
    parent?.kind === NodeKind.Container &&
    index !== undefined &&
    axisOf(parent.layout) === axis
  ) {
    return replacedAt(root, around, () =>
      withChildAt(parent, forward ? index + 1 : index, moving),
    );
  } else if (
    parent?.kind === NodeKind.Container &&
    parent.children.length === 1
  ) {
    // The target alone in its group: the drop relays the group, rather than
    // nesting a split in it.
    return replacedAt(root, around, () =>
      Node.Container(
        splitFor(axis),
        forward ? [...parent.children, moving] : [moving, ...parent.children],
        forward ? 1 : 0,
      ),
    );
  } else {
    return replacedAt(root, at, (node) =>
      Node.Container(
        splitFor(axis),
        forward ? [node, moving] : [moving, node],
        forward ? 1 : 0,
      ),
    );
  }
};

const tiledRoot = ({ root }: Tiling): LayoutNode => {
  if (root === undefined) {
    throw new Error("layout tree: nothing is tiled to drop a window on");
  } else {
    return root;
  }
};

const pathOf = (root: LayoutNode, id: string): Path => {
  const path = pathTo(root, id);
  if (path === undefined) {
    throw new Error(`layout tree: no tiled window ${id} to drag`);
  } else {
    return path;
  }
};
