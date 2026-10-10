// The layout tree for a workspace's tiled windows, following sway's model:
// windows are leaves, and each layout is a container.
//
// The union is written out instead of derived with `ReturnType`, because the
// type is recursive and deriving it would make it reference itself.

import type { Axis } from "../direction";
import { Axis as AxisOf } from "../direction";

/**
 * How a container arranges its children, as in sway.
 *
 * A split lays them out along an axis. Tabbed and stacking show one at a time,
 * with titles for all.
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

/** A container of nodes arranged in one {@link Layout}. */
export type Container = {
  /**
   * Its children in layout order. Never empty; an empty workspace has no root
   * instead.
   */
  children: readonly LayoutNode[];
  /**
   * The last-focused child.
   *
   * Kept even when focus is elsewhere: a tabbed container shows it, and focus
   * returns to it.
   */
  focused: number;
  /** Each child's share of the container's axis. One per child, summing to 1. */
  fractions: readonly number[];
  kind: NodeKind.Container;
  layout: Layout;
};

/** A window leaf in the tree. */
export type WindowNode = {
  /**
   * When the window last took focus: higher is more recent, and 0 is never.
   *
   * Plays the part of sway's focus stack. Kept on the window, so it moves with
   * it.
   */
  focusedAt: number;
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

  Window: (id: string, focusedAt = 0): WindowNode => ({
    focusedAt,
    id,
    kind: NodeKind.Window,
  }),
};

/**
 * The container with `child` inserted at `index` and focused.
 *
 * Resets all shares to even, as i3 and sway do, so the new child does not
 * take half of one sibling.
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
 * The shares scaled to sum to 1.
 *
 * Used after a removal, so the rest keep their relative sizes.
 */
export const renormalized = (
  fractions: readonly number[],
): readonly number[] => {
  const total = fractions.reduce((sum, fraction) => sum + fraction, 0);
  return total === 0
    ? evenly(fractions.length)
    : fractions.map((fraction) => fraction / total);
};

/** The axis directional keys walk this layout along. */
export const axisOf = (layout: Layout): Axis => {
  switch (layout) {
    // Tabs run across, so tabbed is horizontal; stacked titles form a column.
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

/** The split layout along `axis`. */
export const splitFor = (axis: Axis): Layout =>
  axis === AxisOf.Horizontal ? Layout.SplitH : Layout.SplitV;

/** Whether this layout shows one child at a time. */
export const showsOneChild = (layout: Layout): boolean =>
  layout === Layout.Tabbed || layout === Layout.Stacking;

/** Every window in `node`, in layout order. */
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

/** The latest {@link WindowNode.focusedAt} of any window in `node`. */
export const lastFocusIn = (node: LayoutNode): number => {
  switch (node.kind) {
    case NodeKind.Container: {
      return Math.max(...node.children.map((child) => lastFocusIn(child)));
    }
    case NodeKind.Window: {
      return node.focusedAt;
    }
  }
};
