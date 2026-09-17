// What is on the screen right now: one rectangle per visible window, and the
// order they stack in.
//
// The join between the state and the page. Nothing above this knows about
// trees or workspaces, and nothing below it knows how big a screen is — the
// geometry comes from the display the chrome is on, which only the chrome
// knows, so it is an argument rather than a field.

import { rectOf } from "./floating/float";
import type { Rect } from "./rect";
import { barOf, surfaceOf } from "./rect";
import type { Tab } from "./tree/frames";
import { framesOf } from "./tree/frames";
import { windowsOf } from "./tree/tiling";
import type { WindowState } from "./window-state";
import { workspaceOn } from "./window-state";
import type { Workspace } from "./workspace";

/** Where one window is drawn, and how it stacks against the others. */
export type Placement = {
  /** Its title bar: its own, or its tab in the container it is in. */
  bar: Rect;
  /**
   * The window's own `z-index`, which the SDK reports with the placement and
   * the compositor hit-tests and stacks the client's surface by.
   */
  depth: number;
  id: string;
  /**
   * Where its contents go, or `undefined` for a window a tabbed container is
   * not showing: the tab is on screen and the window behind it is not.
   */
  surface: Rect | undefined;
};

/** The rectangles the screen the chrome is on has to offer. */
export type Geometry = {
  /** Every display's bounding box — what `fullscreen global` fills. */
  desktop: Rect;
  /** The screen the chrome is on, which is what `fullscreen` fills. */
  screen: Rect;
  /** What is left of that screen under the top bar: where the windows go. */
  workspace: Rect;
};

/** Everything the screen shows: the windows, and the tabs of any container. */
export type Screenful = {
  placements: readonly Placement[];
  tabs: readonly Tab[];
};

/**
 * How far apart neighbouring windows are — `gaps.inner` from the config.
 *
 * With `gaps.smartGaps`, which is what the caller below applies: a workspace
 * showing one window has nothing to space it away from, so it gets the screen.
 */
const INNER_GAP = 20;

/** The `z-index` the tiled windows share: the bottom of the page's stack. */
const TILED = 0;

/** The lowest `z-index` a floating window is given — above every tiled one. */
const FLOATING = 1;

/**
 * Over every float, because a window filling the screen is filling it: sway's
 * fullscreen covers whatever else the workspace had on it.
 */
const FULLSCREEN = 1000;

export const placementsOf = (
  state: WindowState,
  geometry: Geometry,
): Screenful => {
  const workspace = workspaceOn(state);
  const full = fullscreen(workspace, geometry);
  if (full === undefined) {
    // `gaps.smartGaps`: a workspace showing one window gets the whole screen.
    const gap = windowsOf(workspace.tiling).length > 1 ? INNER_GAP : 0;
    const { frames, tabs } = framesOf(
      workspace.tiling,
      geometry.workspace,
      gap,
    );
    return {
      placements: [
        ...frames.map((frame) => ({ ...frame, depth: TILED })),
        // Over them, in the order the workspace stacks them.
        ...workspace.floats.map((float, at) => ({
          bar: barOf(rectOf(float)),
          depth: FLOATING + at,
          id: float.id,
          surface: surfaceOf(rectOf(float)),
        })),
      ],
      tabs,
    };
  } else {
    return { placements: [full], tabs: [] };
  }
};

// The one window a fullscreen workspace shows, or `undefined` when none is
// asked for. A fullscreen that names a window the workspace no longer has is
// nothing to draw — `closed` clears it, so this is the ordering rather than a
// state anyone can reach.
const fullscreen = (
  workspace: Workspace,
  geometry: Geometry,
): Placement | undefined => {
  const { fullscreen: full } = workspace;
  if (full === undefined) {
    return undefined;
  } else {
    const area = full.global ? geometry.desktop : geometry.screen;
    return {
      bar: barOf(area),
      depth: FULLSCREEN,
      id: full.id,
      surface: surfaceOf(area),
    };
  }
};
