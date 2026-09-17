// A window leaving the tree, and what the layout around it collapses into.

import type { Container, LayoutNode } from "./node";
import { LayoutNode as Node, NodeKind, renormalized } from "./node";
import type { Path } from "./path";
import { pathTo } from "./path";
import type { Tiling } from "./tiling";
import { focusChainOf, NOTHING_TILED } from "./tiling";

/**
 * The tree without the window `id`.
 *
 * A container left holding one node is flattened into that node, and one left
 * holding nothing goes the way its child did — up to and including the root,
 * which is how a workspace empties.
 *
 * The same tiling comes back for a window it never held: the host drains its
 * events for windows this tree never had, and a close that names one of those
 * is not its business.
 */
export const removed = (tiling: Tiling, id: string): Tiling => {
  const { root } = tiling;
  const path = root === undefined ? undefined : pathTo(root, id);
  if (root === undefined || path === undefined) {
    return tiling;
  } else {
    const kept = withoutAt(root, path);
    return kept === undefined
      ? NOTHING_TILED
      : // On a window rather than on whatever container the focus was pointed
        // at: the shape that container named may not be there any more.
        { depth: focusChainOf(kept).length, root: kept };
  }
};

/**
 * `node` with the descendant at `path` taken out, or `undefined` when nothing
 * of `node` is left once it has gone.
 *
 * Exported because moving a window is taking it out and putting it back
 * somewhere else, and where it comes *from* collapses exactly the way a close
 * makes it collapse.
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
 * The container with its child `index` gone: flattened into what is left when
 * that is one node, and gone itself when it is none.
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
      focusAfter(container.focused, index, children.length),
      renormalized(container.fractions.filter((_, at) => at !== index)),
    );
  }
};

/**
 * Which child the focus lands on once the one at `removed` is gone.
 *
 * The next window along, which is the same index once the list has closed up,
 * and the one before it where there is no next. A focus that was somewhere
 * else entirely follows its own child.
 */
const focusAfter = (
  focused: number,
  removed: number,
  length: number,
): number => (removed < focused ? focused - 1 : Math.min(focused, length - 1));

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
