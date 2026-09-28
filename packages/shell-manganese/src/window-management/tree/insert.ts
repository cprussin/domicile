// A window opening into the tree: beside the one being worked in, and focused.

import type { LayoutNode } from "./node";
import { Layout, LayoutNode as Node, NodeKind, withChildAt } from "./node";
import { nodeAt, replacedAt } from "./path";
import type { Tiling } from "./tiling";
import { focusPathOf, withFocusOn } from "./tiling";

/**
 * The layout a workspace's first container has: sway's `workspace_layout`,
 * which this desktop sets to tabbed.
 */
const WORKSPACE_LAYOUT = Layout.Tabbed;

/**
 * The tree with the window `id` opened in it, focused.
 *
 * Where it lands is sway's rule and depends on what the focus is pointed at: a
 * window gets a sibling beside it, and a container that `focus parent`
 * selected gets a child of its own.
 */
export const inserted = (tiling: Tiling, id: string): Tiling => {
  const { root } = tiling;
  const opened = Node.Window(id);
  if (root === undefined) {
    return { depth: 0, root: opened };
  } else {
    return withFocusOn(
      { ...tiling, root: besideFocus(root, tiling.depth, opened) },
      id,
    );
  }
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
      // Into the container itself, after the child it last had the focus in.
      return replacedAt(root, path, () =>
        withChildAt(focused, focused.focused + 1, opened),
      );
    }
    case NodeKind.Window: {
      return besideWindow(root, path, opened);
    }
  }
};

// A window's sibling, which is a question for its parent — and where there is
// no parent, the workspace's first container: one window becomes two tabs.
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
