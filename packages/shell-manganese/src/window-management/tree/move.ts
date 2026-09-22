// `move left` and the other three: the focused window (or the container
// `focus parent` selected) carried through the tree.
//
// The same outward walk `focus-direction.ts` does, with a different thing to
// do at each stop. Inside the container the window is *in*, moving is
// reordering it past its neighbor — or, where that neighbor is a container
// rather than a window, *into* it, as far in as whatever that container is
// showing, which is how a split and a move make a group. In a container
// further out — one that runs the right way where the window's own does
// not — it is the window leaving the container it was in and landing beside
// it. And where nothing around it runs that way at all,
// the workspace itself gains a split of the other orientation, which is what
// i3 does with a window pushed across the grain.

import type { Direction } from "../direction";
import { axisOf as axisOfDirection, isForward } from "../direction";
import type { Container, LayoutNode } from "./node";
import {
  axisOf,
  LayoutNode as Node,
  NodeKind,
  splitFor,
  withChildAt,
} from "./node";
import type { Ancestor, Path } from "./path";
import { ancestorsOf, nodeAt, replacedAt } from "./path";
import { withoutAt } from "./remove";
import type { Tiling } from "./tiling";
import { focusedChildIn, focusPathOf, withCommandsOn } from "./tiling";

/** The tiling with what the focus is pointed at moved one place `direction`. */
export const movedBy = (tiling: Tiling, direction: Direction): Tiling => {
  const { root } = tiling;
  if (root === undefined) {
    return tiling;
  } else {
    const path = focusPathOf(root, tiling.depth);
    const moving = nodeAt(root, path);
    const moved = relocated(root, path, moving, direction);
    // What moved stays what the keys are pointed at wherever it landed — the
    // window, or the container `focus parent` selected — which is also what
    // re-points every container it moved through.
    return moved === undefined
      ? tiling
      : withCommandsOn({ ...tiling, root: moved }, moving);
  }
};

/**
 * The whole tree with `moving` somewhere else, or `undefined` when there is
 * nowhere for it to go.
 *
 * The candidates in the order sway tries them: the container the window is in,
 * then each container outside it that runs the right way, and last the
 * workspace itself.
 */
const relocated = (
  root: LayoutNode,
  path: Path,
  moving: LayoutNode,
  direction: Direction,
): LayoutNode | undefined => {
  if (path.length === 0) {
    // The whole workspace is the one window, which has nowhere to be moved to.
    return undefined;
  } else {
    const along = ancestorsOf(root, path).filter(
      (ancestor) =>
        axisOf(ancestor.container.layout) === axisOfDirection(direction),
    );
    const tried = along.map((ancestor) =>
      holds(ancestor, path)
        ? reordered(root, ancestor, direction)
        : movedOut(root, ancestor, path, moving, direction),
    );
    return (
      tried.find((candidate) => candidate !== undefined) ??
      acrossWorkspace(root, path, moving, direction)
    );
  }
};

/** Whether this container is the one the moving node is directly in. */
const holds = ({ path }: Ancestor, moving: Path): boolean =>
  path.length === moving.length - 1;

// Past its neighbor, or into it: a neighbor that is a window is one the
// moving node trades places with, and a neighbor that is a container is one
// it goes inside.
const reordered = (
  root: LayoutNode,
  ancestor: Ancestor,
  direction: Direction,
): LayoutNode | undefined => {
  const { container, index } = ancestor;
  const to = index + (isForward(direction) ? 1 : -1);
  const neighbor = container.children[to];
  const moving = container.children[index];
  if (neighbor === undefined || moving === undefined) {
    return undefined;
  } else if (neighbor.kind === NodeKind.Container) {
    return joined(root, ancestor, to, neighbor, moving, direction);
  } else {
    return traded(root, ancestor, to, neighbor, moving);
  }
};

/**
 * The moving node inside the container beside it, which is what a split and a
 * move make one group out of.
 *
 * Where it lands in there is sway's rule, which is a descent rather than a
 * place: see {@link entryInto}. It goes in at the edge it came from where
 * the container runs the way it is moving, and where that container runs
 * across it the same question is asked again of whatever it is showing.
 *
 * **The two containers answer for their sizes differently, on purpose.** What
 * the node was in *lost* a child and nothing was put back, so it collapses
 * the way a closed window's container does: the windows left in it keep the
 * sizes they were dragged to relative to each other, and share out what the
 * one that went was using. What the node joined *gained* one, which is
 * the arrival {@link withChildAt} evens out — the same answer a window
 * opening into a container gets, and for the same reason: the alternative is
 * a node taking half of whichever sibling it happened to land beside.
 */
const joined = (
  root: LayoutNode,
  { container, index, path }: Ancestor,
  to: number,
  neighbor: Container,
  moving: LayoutNode,
  direction: Direction,
): LayoutNode => {
  const { at, into, path: inside } = entryInto(neighbor, direction);
  const entered = replacedAt(neighbor, inside, () =>
    withChildAt(into, at, moving),
  );
  // Taken out of the container the way a close takes a window out, because
  // that is what the container has lost: nothing was put back into it, so
  // what is left keeps the sizes it was dragged to and shares out what went.
  const kept = withoutAt(
    {
      ...container,
      children: container.children.map((child, at) =>
        at === to ? entered : child,
      ),
    },
    [index],
  );
  if (kept === undefined) {
    // Which nothing can reach: only a container of one comes back empty, and
    // this one holds at least two — the node being moved, and the neighbor it
    // is being moved into.
    throw new Error("layout tree: a container of two has lost both of them");
  } else {
    return replacedAt(root, path, () => kept);
  }
};

// A swap, so the two boxes keep their sizes and trade contents: a window
// moved along a row of resized windows does not resize the row.
const traded = (
  root: LayoutNode,
  { container, index, path }: Ancestor,
  to: number,
  neighbor: LayoutNode,
  moving: LayoutNode,
): LayoutNode =>
  replacedAt(root, path, () => ({
    ...container,
    children: container.children.map((child, at) => {
      switch (at) {
        case index: {
          return neighbor;
        }
        case to: {
          return moving;
        }
        default: {
          return child;
        }
      }
    }),
    focused: to,
  }));

/** Where a node moved `direction` into a container ends up. */
type Entry = {
  /**
   * Where among {@link into}'s children it goes — the index it is put in
   * front of, which is the length of the list where it goes on the end.
   */
  at: number;
  /** The container that ends up holding it. */
  into: Container;
  /** Where that container is, from the neighbor the node was moved at. */
  path: Path;
};

/**
 * Where a node moved `direction` into `container` lands.
 *
 * sway's own descent — `container_move_to_container_from_direction` calls
 * itself. A container running the way the node is moving takes it at the edge
 * it came from: the near end of a row, the first of a set of tabs, with
 * everything already in there past it. One running *across* is not where the
 * question stops, because the node has to land somewhere along it — so the
 * same question is asked of whatever that container last had the focus in,
 * down to the window it is showing, and the node lands beside that window on
 * the side it came from.
 */
const entryInto = (container: Container, direction: Direction): Entry => {
  const forward = isForward(direction);
  if (axisOf(container.layout) === axisOfDirection(direction)) {
    return {
      at: forward ? 0 : container.children.length,
      into: container,
      path: [],
    };
  } else {
    const showing = focusedChildIn(container);
    switch (showing.kind) {
      case NodeKind.Window: {
        return {
          at: container.focused + (forward ? 0 : 1),
          into: container,
          path: [],
        };
      }
      case NodeKind.Container: {
        const inside = entryInto(showing, direction);
        return { ...inside, path: [container.focused, ...inside.path] };
      }
    }
  }
};

// Out of whatever it was in and in beside it, in the container that runs the
// right way. What it leaves behind collapses the way a closed window's
// container does.
const movedOut = (
  root: LayoutNode,
  { container, index, path }: Ancestor,
  moving: Path,
  node: LayoutNode,
  direction: Direction,
): LayoutNode => {
  const inside = container.children[index];
  if (inside === undefined) {
    throw new Error("layout tree: the path runs through a child that is gone");
  } else {
    const kept = withoutAt(inside, moving.slice(path.length + 1));
    const siblings =
      kept === undefined
        ? container.children.filter((_, at) => at !== index)
        : container.children.map((child, at) => (at === index ? kept : child));
    // Into the slot the branch it came from left empty, or past that branch.
    const at = kept !== undefined && isForward(direction) ? index + 1 : index;
    const children = [...siblings.slice(0, at), node, ...siblings.slice(at)];
    return replacedAt(root, path, () => flattened(container, children, at));
  }
};

/**
 * The workspace split the other way, with the window on that side of
 * everything else.
 *
 * `undefined` where the root already runs the way the window is being pushed:
 * that is the edge of the workspace, and there is nowhere further to go.
 */
const acrossWorkspace = (
  root: LayoutNode,
  path: Path,
  moving: LayoutNode,
  direction: Direction,
): LayoutNode | undefined => {
  const axis = axisOfDirection(direction);
  const rest = withoutAt(root, path);
  if (
    rest === undefined ||
    (root.kind === NodeKind.Container && axisOf(root.layout) === axis)
  ) {
    return undefined;
  } else {
    const forward = isForward(direction);
    return Node.Container(
      splitFor(axis),
      forward ? [rest, moving] : [moving, rest],
      forward ? 1 : 0,
    );
  }
};

/** A container of one node is that node, the way a closed window leaves one. */
const flattened = (
  container: Container,
  children: readonly LayoutNode[],
  focused: number,
): LayoutNode => {
  const [only] = children;
  return children.length === 1 && only !== undefined
    ? only
    : Node.Container(container.layout, children, focused);
};
