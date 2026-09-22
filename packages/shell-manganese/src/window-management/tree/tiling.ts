// A workspace's tiled windows: the tree, and how deep in it the focus sits.
//
// **Focus is one chain and a depth along it.** Every container keeps which
// child it last had the focus in, so following those from the root reaches
// exactly one window — that is the window the keyboard is in, always. The
// depth says how much of that chain the *commands* are pointed at: at the full
// length the focus is the window, and `focus parent` shortens it by one so
// that a split or a layout change acts on the container instead. Two facts in
// two places would have to be kept in step; this way there is one.

import type { Container, LayoutNode } from "./node";
import { NodeKind, windowsIn } from "./node";
import type { Path } from "./path";
import { nodeAt, pathTo } from "./path";

export type Tiling = {
  /** How many children of the chain below the commands are pointed at. */
  depth: number;
  /** The tree, or `undefined` for a workspace with nothing tiled on it. */
  root: LayoutNode | undefined;
};

/** A workspace with nothing tiled on it. */
export const NOTHING_TILED: Tiling = { depth: 0, root: undefined };

/** Every tiled window, in the order they are laid out. */
export const windowsOf = ({ root }: Tiling): readonly string[] =>
  root === undefined ? [] : windowsIn(root);

/** The window the keyboard is in, or `undefined` when nothing is tiled. */
export const focusedIdOf = ({ root }: Tiling): string | undefined =>
  root === undefined ? undefined : focusedWindowIn(root);

/** The window at the end of `node`'s own chain of focused children. */
export const focusedWindowIn = (node: LayoutNode): string => {
  switch (node.kind) {
    case NodeKind.Container: {
      return focusedWindowIn(focusedChildIn(node));
    }
    case NodeKind.Window: {
      return node.id;
    }
  }
};

/**
 * The node the commands are pointed at — a window, or the container `focus
 * parent` selected.
 *
 * Throws on an empty workspace: there is nothing there to command, and the
 * callers all ask whether anything is tiled first.
 */
export const focusedNodeOf = (tiling: Tiling): LayoutNode => {
  const { root } = tiling;
  if (root === undefined) {
    throw new Error("layout tree: nothing is tiled to be focused");
  } else {
    return nodeAt(root, focusPathOf(root, tiling.depth));
  }
};

/** Where in the tree the commands are pointed. */
export const focusPathOf = (root: LayoutNode, depth: number): Path => {
  const chain = focusChainOf(root);
  return chain.slice(0, Math.min(depth, chain.length));
};

/** The children each container last had the focus in, from the root down. */
export const focusChainOf = (root: LayoutNode): Path => {
  switch (root.kind) {
    case NodeKind.Container: {
      return [root.focused, ...focusChainOf(focusedChildIn(root))];
    }
    case NodeKind.Window: {
      return [];
    }
  }
};

/**
 * The same tree with the focus on the window `id`, container by container on
 * the way to it.
 *
 * Throws for a window that is not tiled here: the callers know which
 * workspace holds a window before they point the focus at it, and a focus on
 * nothing would leave the desktop untypeable.
 */
export const withFocusOn = (tiling: Tiling, id: string): Tiling => {
  const { root } = tiling;
  const path = root === undefined ? undefined : pathTo(root, id);
  if (root === undefined || path === undefined) {
    throw new Error(`layout tree: no tiled window ${id} to focus`);
  } else {
    return { depth: path.length, root: pointedAt(root, path) };
  }
};

/**
 * The same tree with the focus on the window inside `node`, and the commands
 * still pointed at `node` itself.
 *
 * What carries a `focus parent` selection through a move or a layout change,
 * which is what sway does with one: the chain is re-pointed at the window the
 * keyboard is in, and the depth comes back up by however many levels of
 * container the selection holds. For a window it is {@link withFocusOn}
 * exactly, because a window holds none.
 */
export const withCommandsOn = (tiling: Tiling, node: LayoutNode): Tiling => {
  const focused = withFocusOn(tiling, focusedWindowIn(node));
  return { ...focused, depth: focused.depth - focusChainOf(node).length };
};

/**
 * The commands back on the window the tiling's focus is in, whatever
 * `focus parent` had them pointed at.
 *
 * What the keyboard leaving the tiling costs a selection: the tree is not
 * where the keys are going any more, so the container one of them chose is
 * not a thing for the next one to act on — or for the desktop to draw a line
 * around.
 */
export const withCommandsOnWindow = (tiling: Tiling): Tiling =>
  tiling.root === undefined
    ? tiling
    : { ...tiling, depth: focusChainOf(tiling.root).length };

/** `focus parent`: the container the focus is in, up to the root. */
export const focusedParent = (tiling: Tiling): Tiling => ({
  ...tiling,
  depth: Math.max(0, tiling.depth - 1),
});

/** `focus child`: back down the chain, as far as the window it ends on. */
export const focusedChild = (tiling: Tiling): Tiling => {
  const { root } = tiling;
  return root === undefined
    ? tiling
    : {
        ...tiling,
        depth: Math.min(tiling.depth + 1, focusChainOf(root).length),
      };
};

/**
 * The child a container last had the focus in.
 *
 * Throws where that index is not a child, which nothing here can produce: a
 * container holds at least one node and every edit that takes one away brings
 * the index back inside the list.
 *
 * Exported because it is also what a container is *entered* through — see
 * `move.ts` — rather than only what the focus chain runs along.
 */
export const focusedChildIn = (container: Container): LayoutNode => {
  const child = container.children[container.focused];
  if (child === undefined) {
    throw new Error(
      `layout tree: a container of ${container.children.length.toString()} has no child ${container.focused.toString()}`,
    );
  } else {
    return child;
  }
};

// Each container on the way to `path` pointed at the child the path takes,
// which is what makes the chain reach the window at the end of it. The ones
// off the path are the objects they already were.
const pointedAt = (root: LayoutNode, path: Path): LayoutNode => {
  const [index, ...rest] = path;
  if (index === undefined || root.kind === NodeKind.Window) {
    return root;
  } else {
    return {
      ...root,
      children: root.children.map((child, at) =>
        at === index ? pointedAt(child, rest) : child,
      ),
      focused: index,
    };
  }
};
