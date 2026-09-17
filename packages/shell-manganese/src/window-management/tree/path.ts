// Where a node is in the tree, and how one is replaced without rebuilding the
// rest.
//
// A path is the child indices walked from the root, so the empty path is the
// root itself. Every operation on the tree is expressed as one: find the node,
// then rebuild the branch that leads to it. What is off that branch comes back
// as the same object, which is what keeps the windows the focus moved past
// from re-rendering.

import type { Container, LayoutNode } from "./node";
import { NodeKind } from "./node";

export type Path = readonly number[];

/** Where the window `id` is, or `undefined` when it is not in `node`. */
export const pathTo = (node: LayoutNode, id: string): Path | undefined => {
  switch (node.kind) {
    case NodeKind.Container: {
      // The first hit rather than every one: a window is in the tree once.
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
 * The node `path` leads to.
 *
 * Throws where it leads nowhere: a path is built from the tree it is walked
 * in, so one that does not fit is a wiring fault rather than a window that has
 * closed.
 */
export const nodeAt = (root: LayoutNode, path: Path): LayoutNode =>
  path.reduce(
    (node, index) => childAt(containerOf(node, path), index, path),
    root,
  );

/** The same tree with the node at `path` put through `into`. */
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

/** A container `path` runs through, and which of its children it takes. */
export type Ancestor = {
  container: Container;
  /** The child of it the path goes through. */
  index: number;
  /** Where the container itself is. */
  path: Path;
};

/**
 * Every container between the root and `path`, innermost first.
 *
 * Which is the order the keyed commands want it in: `focus right` and `move
 * right` both start at the container the focus is in and work outwards until
 * one of them runs the way they were asked to go.
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
