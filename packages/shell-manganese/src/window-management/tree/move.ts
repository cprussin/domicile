// `move left` and the other three: the focused window (or the container
// `focus parent` selected) carried through the tree.
//
// The same outward walk `focus-direction.ts` does, with a different thing to
// do at each stop. Inside the container the window is *in*, moving is
// reordering it past its neighbour. In a container further out — one that runs
// the right way where the window's own does not — it is the window leaving the
// container it was in and landing beside it. And where nothing around it runs
// that way at all, the workspace itself gains a split of the other
// orientation, which is what i3 does with a window pushed across the grain.

import type { Direction } from "../direction";
import { axisOf as axisOfDirection, isForward } from "../direction";
import type { Container, LayoutNode } from "./node";
import { axisOf, LayoutNode as Node, NodeKind, splitFor } from "./node";
import type { Ancestor, Path } from "./path";
import { ancestorsOf, nodeAt, replacedAt } from "./path";
import { withoutAt } from "./remove";
import type { Tiling } from "./tiling";
import { focusedWindowIn, focusPathOf, withFocusOn } from "./tiling";

/** The tiling with what the focus is pointed at moved one place `direction`. */
export const movedBy = (tiling: Tiling, direction: Direction): Tiling => {
  const { root } = tiling;
  if (root === undefined) {
    return tiling;
  } else {
    const path = focusPathOf(root, tiling.depth);
    const moving = nodeAt(root, path);
    const moved = relocated(root, path, moving, direction);
    // The window stays the one being worked in wherever it landed, which is
    // also what re-points every container it moved through.
    return moved === undefined
      ? tiling
      : withFocusOn({ ...tiling, root: moved }, focusedWindowIn(moving));
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

// Past its neighbour, which is a swap: the two boxes keep their sizes and
// trade contents, so a window moved along a row of resized windows does not
// resize the row.
const reordered = (
  root: LayoutNode,
  { container, index, path }: Ancestor,
  direction: Direction,
): LayoutNode | undefined => {
  const to = index + (isForward(direction) ? 1 : -1);
  const swapped = container.children[to];
  const moving = container.children[index];
  if (swapped === undefined || moving === undefined) {
    return undefined;
  } else {
    return replacedAt(root, path, () => ({
      ...container,
      children: container.children.map((child, at) => {
        switch (at) {
          case index: {
            return swapped;
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
