// A tiled window dragged onto another and let go: sway's `tiling_drag`.
//
// Where it lands is read off where on the other window it was dropped. The
// middle of a window trades places with it; an edge puts the dragged window on
// that side of it — beside it in the container it is in where that container
// runs that way, and in a new split of the two of them where it does not.

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
 * The tiling with the window `id` dropped on the window `target`, at `edge` of
 * it or on its middle where `edge` is `undefined` — and the focus on the
 * window that moved.
 *
 * Throws for a window that is not tiled here: the drag that names both was
 * started on this tiling's own windows.
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
 * The two windows in each other's places, which keeps both boxes the size
 * they were: a drop on a window's middle is a swap rather than a new layout.
 */
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
 * The window `id` taken out and put on the `edge` side of `target`.
 *
 * Taken out first, the way a keyed `move` takes a window out: what it leaves
 * collapses the way a close makes it collapse, so the target's place is read
 * off the tree that is left.
 */
const besideTarget = (
  root: LayoutNode,
  id: string,
  target: string,
  edge: Direction,
): LayoutNode => {
  const rest = withoutAt(root, pathOf(root, id));
  if (rest === undefined) {
    // Which nothing can reach: the target is a second window in this tree,
    // and it is still there once the dragged one has gone.
    throw new Error(`layout tree: dropping ${id} left nothing to drop it on`);
  } else {
    return placedBeside(rest, pathOf(rest, target), Node.Window(id), edge);
  }
};

/**
 * `moving` on the `edge` side of the node at `at`: in the container around it
 * where that runs along the edge's axis, and wrapped up with it in a split of
 * that axis where it does not — which is also what a workspace of one window
 * gets, having no container around it at all.
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
