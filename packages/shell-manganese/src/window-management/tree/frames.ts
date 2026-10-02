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
import type { Path } from "./path";
import type { Tiling } from "./tiling";
import { focusedWindowIn, focusPathOf } from "./tiling";

/** Where one window is: its title bar, and its contents under it. */
export type Frame = {
  /** The bar that names it — its own, or its tab in the container it is in. */
  bar: Rect;
  /**
   * Where a window a tabbed or stacking container is not showing is drawn
   * instead: under the one it is showing, in the same box. `undefined` for a
   * window with a `surface`.
   *
   * Drawn rather than taken off the screen, so that it is already on screen
   * the moment its tab is. A window revealed from nothing takes a frame or two
   * to be drawn, and the desktop shows through for as long as it does —
   * around a window growing in over it, or under one shrinking away off it.
   */
  behind: Rect | undefined;
  id: string;
  /**
   * The window the open tab of its tabbed container is named after, for a tab
   * that is not the open one: what it draws the line under it in the color
   * of, so the edge along the top of the window the strip opens onto runs
   * under every tab. `undefined` for every other bar, a stack's included,
   * whose bars each sit on the next one's edge.
   */
  openTab: string | undefined;
  /**
   * Where its contents go, or `undefined` for a window a tabbed or stacking
   * container is not currently showing: the tab is on screen and the window
   * behind it is not.
   */
  surface: Rect | undefined;
  /**
   * The layout of the container its bar is one of the tabs of, which is which
   * way those tabs run: across for a tabbed one, down for a stack.
   *
   * `undefined` for a window whose bar is its own, and for a container's only
   * tab: closing that closes the container with it, which is a window going
   * rather than a tab.
   */
  tabbed: TabLayout | undefined;
};

/** The layouts that give each child a tab rather than a share of the area. */
export type TabLayout = Layout.Stacking | Layout.Tabbed;

/** A tab standing for a whole container, named after the window inside it. */
export type Tab = {
  /** Whether this is the child its container is showing. */
  active: boolean;
  /** The window the container last had the focus in, which is what names it. */
  id: string;
  /** The window its container's open tab is named after — see `Frame.openTab`. */
  openTab: string | undefined;
  rect: Rect;
};

/** Everything a workspace's tiling puts on screen. */
export type Tiled = {
  frames: readonly Frame[];
  /**
   * The container `focus parent` has selected, or `undefined` while the
   * commands are pointed at a window.
   *
   * What the desktop draws a line around, because a group that nothing on
   * screen marks out is one the user has to keep in their head: the keys that
   * split, lay out and move act on it rather than on the window the keyboard
   * is in, and the window's own frame goes on saying where the keyboard is.
   */
  selection: Rect | undefined;
  tabs: readonly Tab[];
};

const NOTHING: Tiled = { frames: [], selection: undefined, tabs: [] };

/**
 * The tiling laid out over `area`, with `gap` between neighbors.
 *
 * The gap is the caller's because it is a policy rather than a measurement:
 * the desktop's config asks for twenty pixels between windows and none at all
 * when there is only one of them (`gaps.smartGaps`).
 */
export const framesOf = (tiling: Tiling, area: Rect, gap: number): Tiled => {
  const { root } = tiling;
  return root === undefined
    ? NOTHING
    : placed(root, area, gap, focusPathOf(root, tiling.depth));
};

/**
 * The box the node at `path` is laid out in, by the same arithmetic
 * {@link framesOf} places it with.
 *
 * What a drag on a window's edge is measured against: the tree holds shares
 * of a container rather than lengths, so a pointer's pixels become a share by
 * how big that container is on screen.
 */
export const areaOf = (
  root: LayoutNode,
  path: Path,
  area: Rect,
  gap: number,
): Rect => {
  const [index, ...rest] = path;
  if (index === undefined) {
    return area;
  } else if (root.kind === NodeKind.Window) {
    throw new Error(`layout tree: path ${path.join(".")} runs into a window`);
  } else {
    const child = root.children[index];
    if (child === undefined) {
      throw new Error(`layout tree: path ${path.join(".")} leaves the tree`);
    } else {
      return areaOf(child, rest, childArea(root, area, gap, index), gap);
    }
  }
};

/**
 * One node laid out in `area`, and everything inside it.
 *
 * `pointed` is where the commands are, from this node down — the rest of the
 * focus path, or `undefined` for a node they are not pointed inside. It is
 * carried through the same walk the rectangles come out of rather than looked
 * up in a second one, because the rectangle the selected container is drawn at
 * *is* the area this gave it.
 */
const placed = (
  node: LayoutNode,
  area: Rect,
  gap: number,
  pointed: Path | undefined,
): Tiled => {
  switch (node.kind) {
    case NodeKind.Window: {
      return {
        frames: [
          {
            bar: barOf(area),
            behind: undefined,
            id: node.id,
            openTab: undefined,
            surface: surfaceOf(area),
            tabbed: undefined,
          },
        ],
        selection: undefined,
        tabs: [],
      };
    }
    case NodeKind.Container: {
      // The path ending here is this container being the one selected: a
      // window is where it ends when nothing is, and a window is not a group.
      const selection = pointed?.length === 0 ? area : undefined;
      switch (node.layout) {
        case Layout.SplitH:
        case Layout.SplitV: {
          return joined(
            node.children.map((child, at) =>
              placed(
                child,
                sliceOf(node, area, gap, at),
                gap,
                within(pointed, at),
              ),
            ),
            selection,
          );
        }
        case Layout.Stacking:
        case Layout.Tabbed: {
          return titled(node, node.layout, area, gap, pointed, selection);
        }
      }
    }
  }
};

/** The box the child at `at` of `container` is laid out in. */
const childArea = (
  container: Container,
  area: Rect,
  gap: number,
  at: number,
): Rect => {
  switch (container.layout) {
    case Layout.SplitH:
    case Layout.SplitV: {
      return sliceOf(container, area, gap, at);
    }
    case Layout.Stacking:
    case Layout.Tabbed: {
      return contentsOf(container, area);
    }
  }
};

/** Where the commands are pointed from the child at `at` down, if they are. */
const within = (pointed: Path | undefined, at: number): Path | undefined =>
  pointed === undefined || pointed[0] !== at ? undefined : pointed.slice(1);

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
const titled = (
  container: Container,
  layout: TabLayout,
  area: Rect,
  gap: number,
  pointed: Path | undefined,
  selection: Rect | undefined,
): Tiled => {
  const contents = contentsOf(container, area);
  const open = focusedWindowIn(container);
  return joined(
    container.children.map((child, at) => {
      const bar = titleOf(container, area, at);
      const showing = at === container.focused;
      const openTab = layout === Layout.Tabbed && !showing ? open : undefined;
      switch (child.kind) {
        case NodeKind.Window: {
          return {
            frames: [
              {
                bar,
                behind: showing ? undefined : contents,
                id: child.id,
                openTab,
                surface: showing ? contents : undefined,
                tabbed: container.children.length > 1 ? layout : undefined,
              },
            ],
            selection: undefined,
            tabs: [],
          };
        }
        case NodeKind.Container: {
          const tab = {
            active: showing,
            id: focusedWindowIn(child),
            openTab,
            rect: bar,
          };
          const inside = showing
            ? placed(child, contents, gap, within(pointed, at))
            : NOTHING;
          return {
            frames: inside.frames,
            selection: inside.selection,
            tabs: [tab, ...inside.tabs],
          };
        }
      }
    }),
    selection,
  );
};

/** How far apart neighboring tabs are. */
const TAB_GAP = 4;

// Tabs divide the top of the area between them, a little apart; a stack gives
// each child a full-width bar of its own, one under the other.
const titleOf = (container: Container, area: Rect, at: number): Rect => {
  if (container.layout === Layout.Stacking) {
    return { ...barOf(area), y: area.y + TITLE_BAR * at };
  } else {
    const count = container.children.length;
    const width = (area.width - TAB_GAP * (count - 1)) / count;
    return { ...barOf(area), width, x: area.x + (width + TAB_GAP) * at };
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

// The whole tiling has one selection at most, and the first of these is it:
// a container that is selected is not pointed *inside*, so the one this was
// given and the ones that came back from inside it are never both there.
const joined = (
  placements: readonly Tiled[],
  selection: Rect | undefined,
): Tiled => ({
  frames: placements.flatMap(({ frames }) => frames),
  selection:
    selection ??
    placements.find(({ selection: inside }) => inside !== undefined)?.selection,
  tabs: placements.flatMap(({ tabs }) => tabs),
});
