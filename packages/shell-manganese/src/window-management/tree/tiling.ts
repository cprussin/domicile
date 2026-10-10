// A workspace's tiled windows: the layout tree plus a focus depth.
//
// Each container records its focused child, so the chain from the root always
// ends at the keyboard-focused window. `depth` is how much of that chain
// commands target: the full length targets the window, and `focus parent`
// shortens it so commands act on a container. Storing the selection as a depth
// keeps it consistent with the chain.

import type { Container, LayoutNode } from "./node";
import { lastFocusIn, NodeKind, showsOneChild, windowsIn } from "./node";
import type { Path } from "./path";
import { ancestorsOf, nodeAt, pathTo } from "./path";

export type Tiling = {
  /** How many steps of the focus chain commands target. */
  depth: number;
  /** The tree, or `undefined` for a workspace with nothing tiled on it. */
  root: LayoutNode | undefined;
};

/** A workspace with nothing tiled on it. */
export const NOTHING_TILED: Tiling = { depth: 0, root: undefined };

/** Every tiled window, in the order they are laid out. */
export const windowsOf = ({ root }: Tiling): readonly string[] =>
  root === undefined ? [] : windowsIn(root);

/** The keyboard-focused window, or `undefined` when nothing is tiled. */
export const focusedIdOf = ({ root }: Tiling): string | undefined =>
  root === undefined ? undefined : focusedWindowIn(root);

/** The window at the end of `node`'s focus chain. */
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
 * The window visible where `id` is drawn: `id`, or the open tab of the
 * outermost tabbed or stacking container hiding it.
 *
 * Throws if `id` is not in `root`.
 */
export const shownOver = (root: LayoutNode, id: string): string => {
  const path = pathTo(root, id);
  if (path === undefined) {
    throw new Error(`layout tree: no window ${id} to show`);
  } else {
    const hiding = ancestorsOf(root, path).findLast(
      ({ container, index }) =>
        showsOneChild(container.layout) && index !== container.focused,
    );
    return hiding === undefined ? id : focusedWindowIn(hiding.container);
  }
};

/**
 * The node commands target: a window, or the container `focus parent`
 * selected.
 *
 * Throws on an empty workspace; callers check for one first.
 */
export const focusedNodeOf = (tiling: Tiling): LayoutNode => {
  const { root } = tiling;
  if (root === undefined) {
    throw new Error("layout tree: nothing is tiled to be focused");
  } else {
    return nodeAt(root, focusPathOf(root, tiling.depth));
  }
};

/** The path to the node commands target. */
export const focusPathOf = (root: LayoutNode, depth: number): Path => {
  const chain = focusChainOf(root);
  return chain.slice(0, Math.min(depth, chain.length));
};

/** Each container's focused child index, from the root down. */
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
 * The tiling with focus on window `id` and every container on its path.
 *
 * Throws if `id` is not tiled here: focusing nothing would leave the desktop
 * without keyboard focus.
 */
export const withFocusOn = (tiling: Tiling, id: string): Tiling => {
  const { root } = tiling;
  const path = root === undefined ? undefined : pathTo(root, id);
  if (root === undefined || path === undefined) {
    throw new Error(`layout tree: no tiled window ${id} to focus`);
  } else {
    // Stamp only a focus change, so the focused window stays the latest.
    const stamp =
      focusedWindowIn(root) === id ? undefined : lastFocusIn(root) + 1;
    return { depth: path.length, root: pointedAt(root, path, stamp) };
  }
};

/**
 * The tiling with focus on the window inside `node` and commands targeting
 * `node`.
 *
 * Keeps a `focus parent` selection across a move or layout change, as sway
 * does. For a window it equals {@link withFocusOn}.
 */
export const withCommandsOn = (tiling: Tiling, node: LayoutNode): Tiling => {
  const focused = withFocusOn(tiling, focusedWindowIn(node));
  return { ...focused, depth: focused.depth - focusChainOf(node).length };
};

/**
 * The tiling with commands targeting the focused window, clearing any
 * `focus parent` selection.
 *
 * Used when the keyboard leaves the tiling, so a stale container selection is
 * neither acted on nor outlined.
 */
export const withCommandsOnWindow = (tiling: Tiling): Tiling =>
  tiling.root === undefined
    ? tiling
    : { ...tiling, depth: focusChainOf(tiling.root).length };

/** `focus parent`: select the enclosing container, stopping at the root. */
export const focusedParent = (tiling: Tiling): Tiling => ({
  ...tiling,
  depth: Math.max(0, tiling.depth - 1),
});

/** `focus child`: select one level down, stopping at the window. */
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
 * A container's focused child.
 *
 * Exported for `move.ts`, which enters containers through this child. Throws if
 * `focused` is out of range, which every tree edit prevents.
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

// Sets each container's focus along `path`, and stamps the window at its end
// with `stamp` if given. Nodes off the path keep their identity.
const pointedAt = (
  root: LayoutNode,
  path: Path,
  stamp: number | undefined,
): LayoutNode => {
  const [index, ...rest] = path;
  if (root.kind === NodeKind.Window) {
    return stamp === undefined ? root : { ...root, focusedAt: stamp };
  } else if (index === undefined) {
    throw new Error("layout tree: a focus path ends at a container");
  } else {
    return {
      ...root,
      children: root.children.map((child, at) =>
        at === index ? pointedAt(child, rest, stamp) : child,
      ),
      focused: index,
    };
  }
};
