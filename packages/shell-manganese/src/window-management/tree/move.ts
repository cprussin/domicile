// Directional move (`move left` and so on) of the focused window, or of the
// container `focus parent` selected.
//
// Walks outward like `focus-direction.ts`. In its own container the node
// swaps with a window neighbor or enters a container neighbor. In an outer
// container running that way, it moves out to sit beside its old branch. If
// none runs that way, the workspace is split the other way, as in i3.

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

/** The tiling with the focused node moved one place `direction`. */
export const movedBy = (tiling: Tiling, direction: Direction): Tiling => {
  const { root } = tiling;
  if (root === undefined) {
    return tiling;
  } else {
    const path = focusPathOf(root, tiling.depth);
    const moving = nodeAt(root, path);
    const moved = relocated(root, path, moving, direction);
    // Keep the commands on the moved node, which also updates the focus of
    // every container along its new path.
    return moved === undefined
      ? tiling
      : withCommandsOn({ ...tiling, root: moved }, moving);
  }
};

/**
 * The tree with `moving` relocated, or `undefined` if it cannot move.
 *
 * Tries, in sway's order: its own container, each outer container running
 * that way, then the workspace.
 */
const relocated = (
  root: LayoutNode,
  path: Path,
  moving: LayoutNode,
  direction: Direction,
): LayoutNode | undefined => {
  if (path.length === 0) {
    // A lone root node has nowhere to go.
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

// Swaps with a window neighbor, or enters a container neighbor.
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
 * Moves the node into the neighboring container, at the spot
 * {@link entryInto} picks.
 *
 * Sizes are handled differently on purpose. The old container collapses as
 * after a close, so the remaining windows keep their relative sizes. The new
 * one evens out via {@link withChildAt}, as when a window opens, so the node
 * does not take half of one sibling.
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
  // Remove it as a close would, so the rest keep their relative sizes.
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
    // Unreachable: the container still holds the neighbor.
    throw new Error("layout tree: a container of two has lost both of them");
  } else {
    return replacedAt(root, path, () => kept);
  }
};

// Swaps contents but keeps box sizes, so moving along a resized row does not
// resize it.
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
  /** The index in {@link into}'s children it is inserted at. */
  at: number;
  /** The container that receives it. */
  into: Container;
  /** The path to that container from the neighbor. */
  path: Path;
};

/**
 * Where a node moved `direction` into `container` lands.
 *
 * Mirrors sway's recursive `container_move_to_container_from_direction`. A
 * container running that way takes it at the near end. One running across
 * recurses into its focused child, and the node lands beside the shown window
 * on the side it came from.
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

// Moves the node out of its branch to sit beside it in an outer container
// running that way. The branch collapses as after a close.
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
    // Into the slot of an emptied branch, or past the branch.
    const at = kept !== undefined && isForward(direction) ? index + 1 : index;
    const children = [...siblings.slice(0, at), node, ...siblings.slice(at)];
    return replacedAt(root, path, () => flattened(container, children, at));
  }
};

/**
 * Wraps the workspace in a split along `direction`, with the node on that
 * side.
 *
 * `undefined` if the root is already that split, since the node is at the
 * workspace edge. A tabbed or stacking root still splits.
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
    (root.kind === NodeKind.Container && root.layout === splitFor(axis))
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

/** Collapses a one-child container into its child, as a close does. */
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
