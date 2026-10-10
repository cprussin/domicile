// Dropping a dragged tiled window or group onto a window, as in sway's
// `tiling_drag`.
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
  showsOneChild,
  splitFor,
  windowsIn,
  withChildAt,
} from "./node";
import type { NodeRef, Path } from "./path";
import { nodeAt, pathTo, pathToRef, replacedAt } from "./path";
import { withoutAt } from "./remove";
import type { Tiling } from "./tiling";
import { withCommandsOn } from "./tiling";

/**
 * The tiling with the node `moving` names dropped on window `target`'s
 * `edge`, or its middle when `edge` is `undefined`. Focus and commands go to
 * the moved node, so a dropped group stays selected.
 *
 * Unchanged when `target` is inside `moving`. Throws if either is not tiled
 * here.
 */
export const droppedOn = (
  tiling: Tiling,
  moving: NodeRef,
  target: string,
  edge: Direction | undefined,
): Tiling => {
  const root = tiledRoot(tiling);
  const from = pathToRef(root, moving);
  const node = nodeAt(root, from);
  if (windowsIn(node).includes(target)) {
    return tiling;
  } else {
    const moved =
      edge === undefined
        ? traded(root, from, target)
        : besideTarget(root, from, target, edge);
    return withCommandsOn({ ...tiling, root: moved }, node);
  }
};

/**
 * The tiling with `node`, dragged in from another workspace, dropped on
 * `target`'s `edge`, or in its place when `edge` is `undefined`. Focus and
 * commands go to `node`.
 *
 * Throws if `target` is not tiled here.
 */
export const arrivedOn = (
  tiling: Tiling,
  node: LayoutNode,
  target: string,
  edge: Direction | undefined,
): Tiling => {
  const root = tiledRoot(tiling);
  const at = pathOf(root, target);
  const moved =
    edge === undefined
      ? replacedAt(root, at, () => node)
      : placedBeside(root, at, node, edge);
  return withCommandsOn({ ...tiling, root: moved }, node);
};

/**
 * The tiling with the node `moving` names replaced by `by`, the window it was
 * dropped in the middle of on another workspace.
 *
 * Throws if `moving` is not tiled here.
 */
export const tradedFor = (
  tiling: Tiling,
  moving: NodeRef,
  by: string,
): Tiling => {
  const root = tiledRoot(tiling);
  return {
    ...tiling,
    root: replacedAt(root, pathToRef(root, moving), () => Node.Window(by)),
  };
};

/** Swaps the node at `from` with window `target`, keeping both boxes' sizes. */
const traded = (root: LayoutNode, from: Path, target: string): LayoutNode => {
  const to = pathOf(root, target);
  const moving = nodeAt(root, from);
  return replacedAt(
    replacedAt(root, from, () => nodeAt(root, to)),
    to,
    () => moving,
  );
};

/**
 * Removes the node at `from` and puts it on the `edge` side of `target`.
 *
 * Removes it first, like a keyed `move`, so the tree collapses as after a
 * close before the target is located.
 */
const besideTarget = (
  root: LayoutNode,
  from: Path,
  target: string,
  edge: Direction,
): LayoutNode => {
  const rest = withoutAt(root, from);
  if (rest === undefined) {
    // Unreachable: the target is still in the tree.
    throw new Error(`layout tree: dropping on ${target} left nothing`);
  } else {
    return placedBeside(rest, pathOf(rest, target), nodeAt(root, from), edge);
  }
};

/**
 * Puts `moving` on the `edge` side of the node at `at`: beside its parent if
 * that is a tab group of several, in its parent if that is a split along that
 * axis, else in a new split with the node (also when there is no parent).
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
    showsOneChild(parent.layout) &&
    parent.children.length > 1
  ) {
    // An edge of a tab group's window is an edge of the group, as in sway.
    return placedBeside(root, around, moving, edge);
  } else if (
    parent?.kind === NodeKind.Container &&
    index !== undefined &&
    !showsOneChild(parent.layout) &&
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
