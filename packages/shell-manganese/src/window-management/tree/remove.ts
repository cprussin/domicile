// Removing a window from the tree and collapsing the containers around it.

import type { Container, LayoutNode } from "./node";
import {
  LayoutNode as Node,
  NodeKind,
  renormalized,
  showsOneChild,
} from "./node";
import type { Path } from "./path";
import { pathTo } from "./path";
import type { Tiling } from "./tiling";
import { focusChainOf, NOTHING_TILED } from "./tiling";

/**
 * The tiling without the window `id`.
 *
 * A container left with one child is replaced by that child, and an empty one
 * is removed, up to the root. Returns `tiling` unchanged for an unknown `id`,
 * since the host also reports closes for windows this tree never held.
 */
export const removed = (tiling: Tiling, id: string): Tiling => {
  const { root } = tiling;
  const path = root === undefined ? undefined : pathTo(root, id);
  return root === undefined || path === undefined
    ? tiling
    : removedAt(root, path);
};

/**
 * The tiling without the node at `path`, which may be a container (as when
 * `floating toggle` follows `focus parent`).
 */
export const removedAt = (root: LayoutNode, path: Path): Tiling => {
  const kept = withoutAt(root, path);
  return kept === undefined
    ? NOTHING_TILED
    : // Focus a window: the focused container may no longer exist.
      { depth: focusChainOf(kept).length, root: kept };
};

/**
 * `node` without the descendant at `path`, or `undefined` when nothing is left.
 *
 * Exported for moves, whose source collapses the same way as a close.
 */
export const withoutAt = (
  node: LayoutNode,
  path: Path,
): LayoutNode | undefined => {
  const [index, ...rest] = path;
  if (index === undefined) {
    return undefined;
  } else if (node.kind === NodeKind.Window) {
    throw new Error("layout tree: a window holds no children");
  } else {
    const kept = withoutAt(childAt(node, index), rest);
    return kept === undefined
      ? collapsed(node, index)
      : { ...node, children: replacing(node.children, index, kept) };
  }
};

/**
 * The container without child `index`, replaced by its only remaining child,
 * or `undefined` if none remain.
 */
const collapsed = (
  container: Container,
  index: number,
): LayoutNode | undefined => {
  const children = container.children.filter((_, at) => at !== index);
  const only = children[0];
  if (only === undefined) {
    return undefined;
  } else if (children.length === 1) {
    return only;
  } else {
    return Node.Container(
      container.layout,
      children,
      focusAfter(container, index, children.length),
      renormalized(container.fractions.filter((_, at) => at !== index)),
    );
  }
};

/**
 * The focused index after child `removed` is gone.
 *
 * Closing the focused child focuses the next one in a split and the previous
 * one in a tab stack, falling back to the other side at the ends.
 */
const focusAfter = (
  { focused, layout }: Container,
  removed: number,
  length: number,
): number => {
  if (removed < focused) {
    return focused - 1;
  } else if (removed > focused) {
    return focused;
  } else {
    return showsOneChild(layout)
      ? Math.max(focused - 1, 0)
      : Math.min(focused, length - 1);
  }
};

const childAt = (container: Container, index: number): LayoutNode => {
  const child = container.children[index];
  if (child === undefined) {
    throw new Error(`layout tree: no child ${index.toString()} to remove`);
  } else {
    return child;
  }
};

const replacing = (
  children: readonly LayoutNode[],
  index: number,
  child: LayoutNode,
): readonly LayoutNode[] =>
  children.map((was, at) => (at === index ? child : was));
