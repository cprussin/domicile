// Turns window state into what one screen shows: a rectangle and stacking
// depth per visible window.
//
// Screen geometry is an argument because only the chrome knows which display
// it is on.

import type { Float } from "./floating/float";
import { floatHolds, onScreen, rectOf } from "./floating/float";
import { floatingGapOf, INNER_GAP, tiledAreaOf } from "./gaps";
import type { Rect } from "./rect";
import { barOf, surfaceOf } from "./rect";
import type {
  FocusBox,
  Frame,
  StripPlace,
  Tab,
  TabLayout,
} from "./tree/frames";
import { focusBoxOf, framesOf } from "./tree/frames";
import { focusedWindowIn } from "./tree/tiling";
import type { WindowState } from "./window-state";
import { workspaceOn } from "./window-state";
import type { Workspace } from "./workspace";

/** Where one window is drawn, and how it stacks against the others. */
export type Placement = {
  /** Its title bar, or its tab in a tabbed container. */
  bar: Rect;
  /**
   * For a hidden tab, where it is drawn under the shown one, at
   * {@link COVERED}. `undefined` when `surface` is set. See `Frame.behind`.
   */
  behind: Rect | undefined;
  /**
   * The window's `z-index`.
   *
   * The page's compositor stacks client surfaces by it, and the pointer
   * hit-tests by it, so no separate stacking is reported.
   */
  depth: number;
  /**
   * The bar and contents together; just the bar for a hidden tab.
   *
   * Open and close animations scale both elements about this box's center.
   * Scaling each about its own center would pull them apart.
   */
  frame: Rect;
  id: string;
  /** Whether it is in the container `focus parent` selected. See `Frame.selected`. */
  selected: boolean;
  /** Whether it is its container's only tab. See `Frame.soleTab`. */
  soleTab: boolean;
  /** Its place in its tab strip. See `Frame.strip`. */
  strip: StripPlace | undefined;
  /** Where its contents go, or `undefined` for a hidden tab. */
  surface: Rect | undefined;
  /** The direction of the tab row its bar is in. See `Frame.tabbed`. */
  tabbed: TabLayout | undefined;
};

/** The rectangles of one screen. */
export type Geometry = {
  /** The bounding box of every display, which `fullscreen global` fills. */
  desktop: Rect;
  /** The screen's name, which selects its workspace. */
  name: string;
  /** The whole screen, which `fullscreen` fills. */
  screen: Rect;
  /** The screen below the top bar, where windows go. */
  workspace: Rect;
};

/** A container's tab, stacked with its float, if any. */
export type PlacedTab = Tab & { depth: number };

/** A focus box, stacked with the windows inside it. */
export type PlacedFocusBox = FocusBox & { depth: number };

/** The windows and container tabs a screen shows. */
export type Screenful = {
  /**
   * The box around the window or group commands target, which the chrome
   * lights. `undefined` on an empty workspace or under a fullscreen window.
   */
  focusBox: PlacedFocusBox | undefined;
  placements: readonly Placement[];
  tabs: readonly PlacedTab[];
};

/**
 * The depth of hidden tabs, under every tiled window. See
 * {@link Placement.behind}.
 *
 * The wallpaper shares this depth but comes first in the document, so it stays
 * underneath. It is two below the tiling, leaving -1 for the tab a tab switch
 * is hiding while the new one fades in (`windowConcealing`). If it shared -2
 * with the other hidden tabs, one later in the document would draw over it and
 * show through the fade.
 */
const COVERED = -2;

/** The `z-index` all tiled windows share. */
export const TILED = 0;

/**
 * The lowest floating `z-index`, above every tiled window and its open tabs.
 * Floats are two apart, leaving each one's {@link raised} depth free.
 */
const FLOATING = 2;

/**
 * The depth of a window's open tab and popups: over the window, under the next
 * window up. The open tab slides over its neighbors when tabs swap, since the
 * whole strip shares the window's depth.
 */
export const raised = (depth: number): number => depth + 1;

/**
 * The depth of a closing window, over every open one.
 *
 * Its neighbors grow into its space during the close animation and would
 * otherwise cover it. See `closing.ts` for why it is not just moved to the end
 * of the document.
 */
export const LEAVING = 1000;

/**
 * The depth of a fullscreen window, over everything else, as in sway.
 *
 * It is above `LEAVING` so a closing window does not animate over it. A
 * closing fullscreen window clears its workspace's fullscreen (see
 * `workspace.ts`), so it is never hidden itself.
 */
const FULLSCREEN = 2000;

/**
 * Everything the screen shows, fullscreen included.
 *
 * A fullscreen window is placed at {@link FULLSCREEN} over the normal layout,
 * which stays in place. That lets it animate from its tiled box and back (see
 * `settlingStyles`) while the other windows stay drawn underneath.
 */
export const placementsOf = (
  state: WindowState,
  geometry: Geometry,
): Screenful => {
  const workspace = workspaceOn(state, geometry.name);
  const { frames, tabs } = framesOf(
    workspace.tiling,
    tiledAreaOf(geometry.workspace),
    INNER_GAP,
  );
  // Floats go above, in workspace stacking order, each tree laid out in its box.
  const floating = workspace.floats
    .map((float) => onScreen(float, geometry.screen))
    .map((float, at) => ({
      depth: FLOATING + 2 * at,
      float,
      ...framesOf(float, rectOf(float), floatingGapOf(float)),
    }));
  const laidOut = [
    ...frames.map((frame) => placed(frame, TILED)),
    ...floating.flatMap(({ depth, frames: inFloat }) =>
      inFloat.map((frame) => placed(frame, depth)),
    ),
  ];
  const full = fullscreen(workspace, geometry);
  // Replace the fullscreen window's tiled rectangle instead of adding a second.
  const placements =
    full === undefined
      ? laidOut
      : [...laidOut.filter(({ id }) => id !== full.id), full];
  return {
    focusBox:
      full === undefined
        ? focusBoxIn(workspace, geometry, floating)
        : undefined,
    placements,
    tabs: [
      ...tabs.map((tab) => ({ ...tab, depth: TILED })),
      ...floating.flatMap(({ depth, tabs: inFloat }) =>
        inFloat.map((tab) => ({ ...tab, depth })),
      ),
    ],
  };
};

/**
 * The focus box of the focused float, at its depth, or else of the tiling. A
 * scratchpad window gets none: the box stays on the window under it.
 *
 * Throws if the focused float is not among `floating`: both come from the
 * same workspace.
 */
const focusBoxIn = (
  workspace: Workspace,
  geometry: Geometry,
  floating: readonly { depth: number; float: Float }[],
): PlacedFocusBox | undefined => {
  const { floatFocus, tiling } = workspace;
  if (floatFocus === undefined) {
    const box = focusBoxOf(tiling, tiledAreaOf(geometry.workspace), INNER_GAP);
    return box === undefined ? undefined : { ...box, depth: TILED };
  } else {
    const focused = floating.find(({ float }) => floatHolds(float, floatFocus));
    if (focused === undefined) {
      throw new Error(`placement: no float holds focused ${floatFocus}`);
    } else if (focused.float.scratchpad) {
      return focusBoxIn(
        { ...workspace, floatFocus: focusUnder(floating) },
        geometry,
        floating,
      );
    } else {
      const { depth, float } = focused;
      const box = focusBoxOf(float, rectOf(float), floatingGapOf(float));
      return box === undefined ? undefined : { ...box, depth };
    }
  }
};

/**
 * The window a scratchpad window sits over: the front other float's, else the
 * tiling's (`undefined`).
 */
const focusUnder = (
  floating: readonly { float: Float }[],
): string | undefined => {
  const under = floating.filter(({ float }) => !float.scratchpad).at(-1);
  return under === undefined ? undefined : focusedWindowIn(under.float.root);
};

/**
 * Where a window's contents are drawn and at what depth: its `surface`, its
 * `behind` rect for a hidden tab, or `undefined` when off screen.
 */
export const contentsOf = (
  placement: Placement | undefined,
): { depth: number; rect: Rect } | undefined => {
  if (placement?.surface !== undefined) {
    return { depth: placement.depth, rect: placement.surface };
  } else if (placement?.behind === undefined) {
    return undefined;
  } else {
    return { depth: COVERED, rect: placement.behind };
  }
};

// The workspace's fullscreen window, or `undefined` when there is none.
const fullscreen = (
  workspace: Workspace,
  geometry: Geometry,
): Placement | undefined => {
  const { fullscreen: full } = workspace;
  if (full === undefined) {
    return undefined;
  } else {
    const area = full.global ? geometry.desktop : geometry.screen;
    return placed(
      {
        bar: barOf(area),
        behind: undefined,
        id: full.id,
        selected: false,
        soleTab: false,
        strip: undefined,
        surface: surfaceOf(area),
        tabbed: undefined,
      },
      FULLSCREEN,
    );
  }
};

/**
 * One window's frame, stacked at `depth`. The only place a {@link Placement}
 * is built, so `frame` is computed one way.
 */
const placed = (
  { bar, behind, id, selected, soleTab, strip, surface, tabbed }: Frame,
  depth: number,
): Placement => ({
  bar,
  behind,
  depth,
  frame: surface === undefined ? bar : spanning(bar, surface),
  id,
  selected,
  soleTab,
  strip,
  surface,
  tabbed,
});

/** The smallest box holding both. */
const spanning = (bar: Rect, surface: Rect): Rect => {
  const x = Math.min(bar.x, surface.x);
  const y = Math.min(bar.y, surface.y);
  return {
    height: Math.max(bar.y + bar.height, surface.y + surface.height) - y,
    width: Math.max(bar.x + bar.width, surface.x + surface.width) - x,
    x,
    y,
  };
};
