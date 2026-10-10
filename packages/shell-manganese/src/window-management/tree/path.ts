// Paths into the layout tree, and replacing a node without rebuilding the
// rest.
//
// A path is the child indices from the root; the empty path is the root. Only
// the branch to the node is rebuilt, so untouched subtrees keep their identity
// and do not re-render.

import type { Container, LayoutNode } from "./node";
import { NodeKind } from "./node";

export type Path = readonly number[];

/**
 * A node named by window `id` inside it: the window itself when `up` is 0,
 * else its ancestor `up` levels above it.
 */
export type NodeRef = { id: string; up: number };

/** The path to window `id`, or `undefined` if it is not in `node`. */
export const pathTo = (node: LayoutNode, id: string): Path | undefined => {
  switch (node.kind) {
    case NodeKind.Container: {
      // A window appears only once, so the first hit is enough.
      const found = node.children
        .map((child, index) => {
          const inside = pathTo(child, id);
          return inside === undefined ? undefined : [index, ...inside];
        })
        .find((path) => path !== undefined);
      return found;
    }
    case NodeKind.Window: {
      return node.id === id ? [] : undefined;
    }
  }
};

/**
 * The path to the node `ref` names.
 *
 * Throws if its window is not in `node` or has fewer than `up` ancestors.
 */
export const pathToRef = (node: LayoutNode, { id, up }: NodeRef): Path => {
  const path = pathTo(node, id);
  if (path === undefined || path.length < up) {
    throw new Error(`layout tree: no node ${up.toString()} above ${id}`);
  } else {
    return path.slice(0, path.length - up);
  }
};

/**
 * The node at `path`.
 *
 * Throws if the path does not fit, since that is a bug, not a closed window.
 */
export const nodeAt = (root: LayoutNode, path: Path): LayoutNode =>
  path.reduce(
    (node, index) => childAt(containerOf(node, path), index, path),
    root,
  );

/** The tree with the node at `path` replaced by `into(node)`. */
export const replacedAt = (
  root: LayoutNode,
  path: Path,
  into: (node: LayoutNode) => LayoutNode,
): LayoutNode => {
  const [index, ...rest] = path;
  if (index === undefined) {
    return into(root);
  } else {
    const container = containerOf(root, path);
    return {
      ...container,
      children: container.children.map((child, at) =>
        at === index ? replacedAt(child, rest, into) : child,
      ),
    };
  }
};

/** A container on a path, and the child index the path takes. */
export type Ancestor = {
  container: Container;
  /** The child index the path goes through. */
  index: number;
  /** The container's own path. */
  path: Path;
};

/**
 * Every container between the root and `path`, innermost first, the order
 * directional `focus` and `move` walk them in.
 */
export const ancestorsOf = (
  root: LayoutNode,
  path: Path,
): readonly Ancestor[] =>
  path
    .map((index, depth) => {
      const at = path.slice(0, depth);
      return { container: containerOf(nodeAt(root, at), at), index, path: at };
    })
    .reverse();

const containerOf = (node: LayoutNode, path: Path): Container => {
  if (node.kind === NodeKind.Window) {
    throw new Error(`layout tree: path ${path.join(".")} runs into a window`);
  } else {
    return node;
  }
};

const childAt = (
  container: Container,
  index: number,
  path: Path,
): LayoutNode => {
  const child = container.children[index];
  if (child === undefined) {
    throw new Error(`layout tree: path ${path.join(".")} leaves the tree`);
  } else {
    return child;
  }
};
