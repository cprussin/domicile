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
import type { Frame, Tab } from "./tree/frames";
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
   * The window's own `z-index`.
   *
   * Nothing reports it. The window is a layer in this page's layer tree, so
   * the page's compositor stacks the client's surface by this the way it
   * stacks anything else, and the element it is written on is the one the
   * pointer hit-tests against.
   */
  depth: number;
  /**
   * The whole of what the window occupies: its bar and its contents together.
   *
   * What both of those elements turn about when the window arrives or leaves.
   * They are separate elements, so halves that scaled about their own centers
   * would pull apart by a fraction of the window's height — one shared point
   * is what keeps a frame a frame. It is the box of the bar alone for a window
   * a tab is hiding, which is all such a window has on screen.
   */
  frame: Rect;
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
 * How far apart neighboring windows are — `gaps.inner` from the config.
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

/**
 * And over everything, a window that has closed and is still shrinking away.
 *
 * Because its neighbors are easing into the space it had while it does. At
 * the depth it used to have they would cover it before it had finished going:
 * two elements at one `z-index` are decided by the order they come in the
 * document, and a closing window goes on being drawn where it always was —
 * see `closing.ts` for why it cannot simply be moved to the end.
 *
 * Above `FULLSCREEN` as well, which costs nothing: a workspace showing a
 * fullscreen window places no other window at all, so the only window that can
 * be closing over one is the fullscreen window itself.
 */
export const LEAVING = 2000;

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
        ...frames.map((frame) => placed(frame, TILED)),
        // Over them, in the order the workspace stacks them.
        ...workspace.floats.map((float, at) =>
          placed(
            {
              bar: barOf(rectOf(float)),
              id: float.id,
              surface: surfaceOf(rectOf(float)),
            },
            FLOATING + at,
          ),
        ),
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
    return placed(
      { bar: barOf(area), id: full.id, surface: surfaceOf(area) },
      FULLSCREEN,
    );
  }
};

/**
 * One window's frame, stacked at `depth`.
 *
 * The one place a {@link Placement} is made, so that the box the two halves
 * turn about is worked out once rather than at each of the three ways a
 * window reaches the screen.
 */
const placed = ({ bar, id, surface }: Frame, depth: number): Placement => ({
  bar,
  depth,
  frame: surface === undefined ? bar : spanning(bar, surface),
  id,
  surface,
});

/** The smallest box holding both of them. */
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
