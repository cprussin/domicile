// The tree a workspace's tiled windows are arranged in: sway's own model, in
// which a window is a leaf and every layout is a container holding others.
//
// **The union is written out rather than derived from the constructors.** The
// enum-and-constructor pattern is the repo's default and this keeps both halves
// of it — an enum discriminant, PascalCase constructors, nothing else building
// a node — but `ReturnType` cannot close the loop on a *recursive* type: a
// container's children are `LayoutNode`s, so a type derived from the
// constructor that takes them refers to itself through its own initializer.
// The annotations below are what break that cycle.

import type { Axis } from "../direction";
import { Axis as AxisOf } from "../direction";

/**
 * How a container arranges the children it holds.
 *
 * The four sway has. A split lays its children side by side along an axis; a
 * tabbed or stacking container shows one of them at a time, with a row of
 * titles for the rest.
 */
export enum Layout {
  SplitH,
  SplitV,
  Stacking,
  Tabbed,
}

export enum NodeKind {
  Container,
  Window,
}

/** A container: several nodes arranged in one of the four layouts. */
export type Container = {
  /**
   * What it holds, in the order they are laid out. Never empty — an empty
   * container is a hole in the layout, so a workspace with nothing on it has
   * no root at all.
   */
  children: readonly LayoutNode[];
  /**
   * Which child the focus was last in.
   *
   * A container's own share of the focus, kept whether or not the focus is
   * anywhere inside it: it is what a tabbed container shows, and what the
   * focus lands on when it comes back.
   */
  focused: number;
  /** Each child's share of the container's axis. One per child, summing to 1. */
  fractions: readonly number[];
  kind: NodeKind.Container;
  layout: Layout;
};

/** A window in the tree: nothing but which window it is. */
export type WindowNode = {
  id: string;
  kind: NodeKind.Window;
};

export type LayoutNode = Container | WindowNode;

export const LayoutNode = {
  Container: (
    layout: Layout,
    children: readonly LayoutNode[],
    focused = 0,
    fractions: readonly number[] = evenly(children.length),
  ): Container => {
    if (children.length === 0) {
      throw new Error("layout tree: a container holds at least one node");
    } else {
      return { children, focused, fractions, kind: NodeKind.Container, layout };
    }
  },

  Window: (id: string): WindowNode => ({ id, kind: NodeKind.Window }),
};

/**
 * The same container with `child` put in at `index`, and the focus on it.
 *
 * Everything in it is resized to an even share, which is what i3 and sway do
 * for a window opening into a container: the alternative is a new window
 * taking half of whichever sibling it landed beside.
 */
export const withChildAt = (
  container: Container,
  index: number,
  child: LayoutNode,
): Container =>
  LayoutNode.Container(
    container.layout,
    [
      ...container.children.slice(0, index),
      child,
      ...container.children.slice(index),
    ],
    index,
  );

/** `count` equal shares of a container. */
export const evenly = (count: number): readonly number[] =>
  Array.from({ length: count }, () => 1 / count);

/**
 * The same shares, scaled back up to fill the container.
 *
 * What a removal leaves behind: the windows that are left keep the sizes they
 * were dragged to relative to each other, and share out what the one that went
 * was using.
 */
export const renormalized = (
  fractions: readonly number[],
): readonly number[] => {
  const total = fractions.reduce((sum, fraction) => sum + fraction, 0);
  return total === 0
    ? evenly(fractions.length)
    : fractions.map((fraction) => fraction / total);
};

/** Which axis this layout runs along, for the keys that walk one. */
export const axisOf = (layout: Layout): Axis => {
  switch (layout) {
    // A tabbed container's titles run across it and its tabs are walked left
    // and right, which makes it horizontal to everything keyed; a stacking
    // one's titles are a column, so it is vertical.
    case Layout.SplitH:
    case Layout.Tabbed: {
      return AxisOf.Horizontal;
    }
    case Layout.SplitV:
    case Layout.Stacking: {
      return AxisOf.Vertical;
    }
  }
};

/** The layout a split along `axis` has. */
export const splitFor = (axis: Axis): Layout =>
  axis === AxisOf.Horizontal ? Layout.SplitH : Layout.SplitV;

/** Whether this layout shows one child at a time rather than all of them. */
export const showsOneChild = (layout: Layout): boolean =>
  layout === Layout.Tabbed || layout === Layout.Stacking;

/** Every window in `node`, in the order they are laid out. */
export const windowsIn = (node: LayoutNode): readonly string[] => {
  switch (node.kind) {
    case NodeKind.Container: {
      return node.children.flatMap((child) => windowsIn(child));
    }
    case NodeKind.Window: {
      return [node.id];
    }
  }
};
