// The tree as rectangles: where every visible window's frame is, and where
// the tabs of a tabbed or stacking container are.
//
// This is the whole of the layout as far as the page is concerned. A window is
// a box the shell writes as `position: fixed`, so laying the desktop out is
// arithmetic here rather than flow in the document — which is what lets a
// window's frame be one element and its surface another, and what lets the
// compositor be told where a client's buffer goes by measuring the element the
// numbers below placed.

import type { Rect } from "../rect";
import { barOf, surfaceOf, TITLE_BAR } from "../rect";
import type { Container, LayoutNode } from "./node";
import { Layout, NodeKind } from "./node";
import type { Tiling } from "./tiling";
import { focusedWindowIn } from "./tiling";

/** Where one window is: its title bar, and its contents under it. */
export type Frame = {
  /** The bar that names it — its own, or its tab in the container it is in. */
  bar: Rect;
  id: string;
  /**
   * Where its contents go, or `undefined` for a window a tabbed or stacking
   * container is not currently showing: the tab is on screen and the window
   * behind it is not.
   */
  surface: Rect | undefined;
};

/** A tab standing for a whole container, named after the window inside it. */
export type Tab = {
  /** Whether this is the child its container is showing. */
  active: boolean;
  /** The window the container last had the focus in, which is what names it. */
  id: string;
  rect: Rect;
};

/** Everything a workspace's tiling puts on screen. */
export type Tiled = {
  frames: readonly Frame[];
  tabs: readonly Tab[];
};

const NOTHING: Tiled = { frames: [], tabs: [] };

/**
 * The tiling laid out over `area`, with `gap` between neighbors.
 *
 * The gap is the caller's because it is a policy rather than a measurement:
 * the desktop's config asks for twenty pixels between windows and none at all
 * when there is only one of them (`gaps.smartGaps`).
 */
export const framesOf = ({ root }: Tiling, area: Rect, gap: number): Tiled =>
  root === undefined ? NOTHING : placed(root, area, gap);

const placed = (node: LayoutNode, area: Rect, gap: number): Tiled => {
  switch (node.kind) {
    case NodeKind.Window: {
      return {
        frames: [{ bar: barOf(area), id: node.id, surface: surfaceOf(area) }],
        tabs: [],
      };
    }
    case NodeKind.Container: {
      switch (node.layout) {
        case Layout.SplitH:
        case Layout.SplitV: {
          return joined(
            node.children.map((child, at) =>
              placed(child, sliceOf(node, area, gap, at), gap),
            ),
          );
        }
        case Layout.Stacking:
        case Layout.Tabbed: {
          return titled(node, area, gap);
        }
      }
    }
  }
};

/**
 * The part of `area` the child at `at` gets.
 *
 * Each child's share of what is left once the gaps between them are taken
 * out, laid along the container's own axis.
 */
const sliceOf = (
  container: Container,
  area: Rect,
  gap: number,
  at: number,
): Rect => {
  const gaps = gap * (container.children.length - 1);
  const shares = container.fractions.slice(0, at);
  const before = shares.reduce((sum, fraction) => sum + fraction, 0);
  const fraction = container.fractions[at];
  if (fraction === undefined) {
    throw new Error(`layout tree: no share for child ${at.toString()}`);
  } else if (container.layout === Layout.SplitV) {
    const extent = area.height - gaps;
    return {
      ...area,
      height: extent * fraction,
      y: area.y + extent * before + gap * at,
    };
  } else {
    const extent = area.width - gaps;
    return {
      ...area,
      width: extent * fraction,
      x: area.x + extent * before + gap * at,
    };
  }
};

/**
 * A tabbed or stacking container: a title per child along the top, and the
 * one it has the focus in filling what is left.
 *
 * A window that is a direct child has its tab *as* its title bar — one bar
 * rather than two — so it is placed here rather than recursed into. A
 * container child gets a tab of its own instead, named after the window it
 * last had the focus in, and is laid out inside the contents area when it is
 * the one being shown.
 */
const titled = (container: Container, area: Rect, gap: number): Tiled => {
  const contents = contentsOf(container, area);
  return joined(
    container.children.map((child, at) => {
      const bar = titleOf(container, area, at);
      const showing = at === container.focused;
      const surface = showing ? contents : undefined;
      switch (child.kind) {
        case NodeKind.Window: {
          return { frames: [{ bar, id: child.id, surface }], tabs: [] };
        }
        case NodeKind.Container: {
          const tab = {
            active: showing,
            id: focusedWindowIn(child),
            rect: bar,
          };
          const inside = showing ? placed(child, contents, gap) : NOTHING;
          return { frames: inside.frames, tabs: [tab, ...inside.tabs] };
        }
      }
    }),
  );
};

// Tabs divide the top of the area between them; a stack gives each child a
// full-width bar of its own, one under the other.
const titleOf = (container: Container, area: Rect, at: number): Rect => {
  if (container.layout === Layout.Stacking) {
    return { ...barOf(area), y: area.y + TITLE_BAR * at };
  } else {
    const width = area.width / container.children.length;
    return { ...barOf(area), width, x: area.x + width * at };
  }
};

// What is left under the titles, which is one bar's worth for a tabbed
// container and one per child for a stack.
const contentsOf = (container: Container, area: Rect): Rect => {
  const bars =
    container.layout === Layout.Stacking ? container.children.length : 1;
  return {
    ...area,
    height: Math.max(0, area.height - TITLE_BAR * bars),
    y: area.y + TITLE_BAR * bars,
  };
};

const joined = (placements: readonly Tiled[]): Tiled => ({
  frames: placements.flatMap(({ frames }) => frames),
  tabs: placements.flatMap(({ tabs }) => tabs),
});
