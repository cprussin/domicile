// Lays out the tree as rectangles: each visible window's frame, and the tabs
// of tabbed and stacking containers.
//
// Windows are `position: fixed` boxes, so the whole layout is computed here
// instead of by document flow.

import type { Rect } from "../rect";
import { barOf, surfaceOf, TITLE_BAR } from "../rect";
import type { Container, LayoutNode } from "./node";
import { Layout, NodeKind, showsOneChild, windowsIn } from "./node";
import type { Path } from "./path";
import { nodeAt } from "./path";
import type { Tiling } from "./tiling";
import { focusedWindowIn, focusPathOf } from "./tiling";

/** One window's title bar and contents. */
export type Frame = {
  /** Its title bar, or its tab in a tabbed or stacking container. */
  bar: Rect;
  /**
   * For a hidden tab, the box it is drawn in, under the shown one.
   * `undefined` when `surface` is set.
   *
   * Hidden tabs stay drawn so a switch shows them at once. A window drawn
   * from nothing takes a frame or two, and the desktop would show through.
   */
  behind: Rect | undefined;
  id: string;
  /**
   * For an inactive tab in a tabbed container, the window the open tab is
   * named after. The tab draws its bottom line in that window's color, so the
   * open window's top edge runs under every tab. `undefined` otherwise,
   * including in stacks.
   */
  openTab: string | undefined;
  /**
   * Whether it is in the container `focus parent` selected, which is
   * highlighted as a group.
   */
  selected: boolean;
  /** Where its contents go, or `undefined` for a hidden tab. */
  surface: Rect | undefined;
  /**
   * The layout of the container whose tab this bar is: tabbed or stacking.
   *
   * `undefined` for a plain title bar and for a container's only tab, since
   * closing that closes the container too.
   */
  tabbed: TabLayout | undefined;
};

/** The layouts that give each child a tab instead of a share of the area. */
export type TabLayout = Layout.Stacking | Layout.Tabbed;

/** A tab for a nested container, named after a window inside it. */
export type Tab = {
  /** Whether its container is showing this child. */
  active: boolean;
  /** The container's last-focused window, which names the tab. */
  id: string;
  /** The window its container's open tab is named after. See `Frame.openTab`. */
  openTab: string | undefined;
  rect: Rect;
  /** Whether it is inside the container `focus parent` selected. */
  selected: boolean;
};

/** The frames and tabs a workspace's tiling puts on screen. */
export type Tiled = {
  frames: readonly Frame[];
  tabs: readonly Tab[];
};

const NOTHING: Tiled = { frames: [], tabs: [] };

/**
 * The tiling laid out over `area`, with `gap` between neighbors.
 *
 * The caller picks the gap, since it is config policy. See `gaps.ts`.
 */
export const framesOf = (tiling: Tiling, area: Rect, gap: number): Tiled => {
  const { root } = tiling;
  return root === undefined
    ? NOTHING
    : placed(root, area, gap, focusPathOf(root, tiling.depth), false);
};

/**
 * The box the node at `path` gets, computed as {@link framesOf} does.
 *
 * Edge drags use it to turn pixels into shares, since the tree stores shares,
 * not lengths.
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

/** The box focus lights in a tiling, and the windows inside it. */
export type FocusBox = {
  rect: Rect;
  windows: readonly string[];
};

/**
 * The box of the node commands target, laid out as {@link framesOf} does, or
 * `undefined` on an empty tiling.
 *
 * A window or group shown as a tab gives the box of its tab group instead,
 * since the tabs belong to the group.
 */
export const focusBoxOf = (
  tiling: Tiling,
  area: Rect,
  gap: number,
): FocusBox | undefined => {
  const { root } = tiling;
  if (root === undefined) {
    return undefined;
  } else {
    const path = tabGroupAround(root, focusPathOf(root, tiling.depth));
    return {
      rect: areaOf(root, path, area, gap),
      windows: windowsIn(nodeAt(root, path)),
    };
  }
};

/**
 * One node and its descendants laid out in `area`.
 *
 * `pointed` is the rest of the focus path below this node, or `undefined` if
 * the focus is not inside it. `selected` is whether the node is inside the
 * container `focus parent` selected.
 */
const placed = (
  node: LayoutNode,
  area: Rect,
  gap: number,
  pointed: Path | undefined,
  selected: boolean,
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
            selected,
            surface: surfaceOf(area),
            tabbed: undefined,
          },
        ],
        tabs: [],
      };
    }
    case NodeKind.Container: {
      // A focus path ending at a container means `focus parent` selected it.
      const inside = selected || pointed?.length === 0;
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
                inside,
              ),
            ),
          );
        }
        case Layout.Stacking:
        case Layout.Tabbed: {
          return titled(node, node.layout, area, gap, pointed, inside);
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

/** The rest of the focus path below child `at`, if it runs through it. */
const within = (pointed: Path | undefined, at: number): Path | undefined =>
  pointed === undefined || pointed[0] !== at ? undefined : pointed.slice(1);

/**
 * The part of `area` child `at` gets: its share of the space left after the
 * gaps, along the container's axis.
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
 * Lays out a tabbed or stacking container: a title per child, and the shown
 * child filling the rest.
 *
 * A window child's tab is its title bar. A container child gets a {@link Tab}
 * named after its last-focused window, and is laid out only when shown.
 */
const titled = (
  container: Container,
  layout: TabLayout,
  area: Rect,
  gap: number,
  pointed: Path | undefined,
  selected: boolean,
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
                selected,
                surface: showing ? contents : undefined,
                tabbed: container.children.length > 1 ? layout : undefined,
              },
            ],
            tabs: [],
          };
        }
        case NodeKind.Container: {
          const tab = {
            active: showing,
            id: focusedWindowIn(child),
            openTab,
            rect: bar,
            selected,
          };
          const inside = showing
            ? placed(child, contents, gap, within(pointed, at), selected)
            : NOTHING;
          return {
            frames: inside.frames,
            tabs: [tab, ...inside.tabs],
          };
        }
      }
    }),
  );
};

/** The gap between neighboring tabs. */
const TAB_GAP = 4;

// Tabs share the top row; a stack gives each child a full-width bar.
const titleOf = (container: Container, area: Rect, at: number): Rect => {
  if (container.layout === Layout.Stacking) {
    return { ...barOf(area), y: area.y + TITLE_BAR * at };
  } else {
    const count = container.children.length;
    const width = (area.width - TAB_GAP * (count - 1)) / count;
    return { ...barOf(area), width, x: area.x + (width + TAB_GAP) * at };
  }
};

// The area under the titles: one bar for tabbed, one per child for stacking.
const contentsOf = (container: Container, area: Rect): Rect => {
  const bars =
    container.layout === Layout.Stacking ? container.children.length : 1;
  return {
    ...area,
    height: Math.max(0, area.height - TITLE_BAR * bars),
    y: area.y + TITLE_BAR * bars,
  };
};

/** `path`, or its parent's path when the parent shows it as a tab. */
const tabGroupAround = (root: LayoutNode, path: Path): Path => {
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(root, parentPath);
  return path.length > 0 &&
    parent.kind === NodeKind.Container &&
    showsOneChild(parent.layout)
    ? parentPath
    : path;
};

const joined = (placements: readonly Tiled[]): Tiled => ({
  frames: placements.flatMap(({ frames }) => frames),
  tabs: placements.flatMap(({ tabs }) => tabs),
});
