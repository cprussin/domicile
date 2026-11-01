// Keeps every window in a tab group, so a new window always opens as a tab.
//
// Splits hold only groups: a window that lands in a split gets a tab group of
// its own, and a split left holding one node is replaced by it. Tree edits
// stay as sway makes them; this runs after each.

import { groupedForWorkspace } from "./insert";
import type { Container, LayoutNode } from "./node";
import { Layout, LayoutNode as Node, NodeKind, showsOneChild } from "./node";
import type { NodeRef } from "./path";
import { ancestorsOf, pathTo } from "./path";
import type { Tiling } from "./tiling";
import { focusChainOf, focusedWindowIn } from "./tiling";

/**
 * The tiling with every window in a group, a lone window included. Commands
 * stay on the node they targeted. The same object when nothing changes.
 */
export const grouped = (tiling: Tiling): Tiling =>
  regrouped(tiling, (root) =>
    root.kind === NodeKind.Window ? groupedForWorkspace(root) : inGroups(root),
  );

/**
 * {@link grouped} for a float's tree: a lone window stays bare, as a dialog
 * floats on its own.
 */
export const groupedBelowRoot = (tiling: Tiling): Tiling =>
  regrouped(tiling, inGroups);

/**
 * The ref naming the same node in `root` once grouped, or the node in its
 * place for a split of one.
 */
export const groupedRef = (root: LayoutNode, { id, up }: NodeRef): NodeRef => {
  const path = pathTo(root, id);
  if (path === undefined) {
    throw new Error(`layout tree: no window ${id} to regroup`);
  } else {
    const above = ancestorsOf(root, path);
    const wrapped =
      above[0] !== undefined && !showsOneChild(above[0].container.layout);
    const kept = above
      .slice(0, up)
      .filter(({ container }) => !isSplitOfOne(container)).length;
    return { id, up: up > 0 && wrapped ? kept + 1 : kept };
  }
};

const regrouped = (
  tiling: Tiling,
  into: (root: LayoutNode) => LayoutNode,
): Tiling => {
  const { root } = tiling;
  if (root === undefined) {
    return tiling;
  } else {
    const after = into(root);
    return after === root ? tiling : repointed(tiling.depth, root, after);
  }
};

// Commands on the node in `after` that stands for the one `depth` targets in
// `before`.
const repointed = (
  depth: number,
  before: LayoutNode,
  after: LayoutNode,
): Tiling => {
  const { up } = groupedRef(before, {
    id: focusedWindowIn(before),
    up: focusChainOf(before).length - depth,
  });
  return { depth: focusChainOf(after).length - up, root: after };
};

const inGroups = (node: LayoutNode): LayoutNode => {
  switch (node.kind) {
    case NodeKind.Container: {
      return containerInGroups(node);
    }
    case NodeKind.Window: {
      return node;
    }
  }
};

const containerInGroups = (container: Container): LayoutNode => {
  const split = !showsOneChild(container.layout);
  const children = container.children.map((child) =>
    split && child.kind === NodeKind.Window
      ? Node.Container(Layout.Tabbed, [child])
      : inGroups(child),
  );
  const [only, ...others] = children;
  if (split && only !== undefined && others.length === 0) {
    return only;
  } else {
    return children.every((child, at) => child === container.children[at])
      ? container
      : { ...container, children };
  }
};

const isSplitOfOne = ({ children, layout }: Container): boolean =>
  !showsOneChild(layout) && children.length === 1;
