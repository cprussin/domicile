// Inserts a new window into the tree next to the focus, and focuses it.

import type { LayoutNode } from "./node";
import { Layout, LayoutNode as Node, NodeKind, withChildAt } from "./node";
import { nodeAt, replacedAt } from "./path";
import type { Tiling } from "./tiling";
import { focusedWindowIn, focusPathOf, withFocusOn } from "./tiling";

/** The layout of a workspace's first container (sway's `workspace_layout`). */
const WORKSPACE_LAYOUT = Layout.Tabbed;

/**
 * The tree with window `id` opened and focused.
 *
 * As in sway, a focused window gets a sibling, and a container selected by
 * `focus parent` gets a new child.
 */
export const inserted = (tiling: Tiling, id: string): Tiling =>
  insertedNode(tiling, Node.Window(id));

/**
 * The same for a whole node, such as a floating group rejoining the tiling.
 * Focus goes to its last-focused window.
 */
export const insertedNode = (tiling: Tiling, node: LayoutNode): Tiling => {
  const { root } = tiling;
  return withFocusOn(
    {
      ...tiling,
      root: root === undefined ? node : besideFocus(root, tiling.depth, node),
    },
    focusedWindowIn(node),
  );
};

const besideFocus = (
  root: LayoutNode,
  depth: number,
  opened: LayoutNode,
): LayoutNode => {
  const path = focusPathOf(root, depth);
  const focused = nodeAt(root, path);
  switch (focused.kind) {
    case NodeKind.Container: {
      // Into the container, after its last-focused child.
      return replacedAt(root, path, () =>
        withChildAt(focused, focused.focused + 1, opened),
      );
    }
    case NodeKind.Window: {
      return besideWindow(root, path, opened);
    }
  }
};

// Adds a sibling after the window. A lone root window gets a new
// `WORKSPACE_LAYOUT` container.
const besideWindow = (
  root: LayoutNode,
  path: readonly number[],
  opened: LayoutNode,
): LayoutNode => {
  const at = path.at(-1);
  return at === undefined
    ? Node.Container(WORKSPACE_LAYOUT, [root, opened], 1)
    : replacedAt(root, path.slice(0, -1), (parent) => {
        if (parent.kind === NodeKind.Window) {
          throw new Error("layout tree: a window is not a parent");
        } else {
          return withChildAt(parent, at + 1, opened);
        }
      });
};
