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
  /**
   * The container `focus parent` selected, or `undefined` while the commands
   * are pointed at a window — see `tree/frames.ts`.
   */
  selection: Rect | undefined;
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
export const TILED = 0;

/** The lowest `z-index` a floating window is given — above every tiled one. */
const FLOATING = 1;

/**
 * Over every window that is still open, a window that has closed and is still
 * shrinking away.
 *
 * Because its neighbors are easing into the space it had while it does. At
 * the depth it used to have they would cover it before it had finished going:
 * two elements at one `z-index` are decided by the order they come in the
 * document, and a closing window goes on being drawn where it always was —
 * see `closing.ts` for why it cannot simply be moved to the end.
 */
export const LEAVING = 1000;

/**
 * And over all of that, a window filling the screen: sway's fullscreen covers
 * whatever else the workspace has on it, and here that is everything the page
 * draws — the floats, and a window on its way out among them.
 *
 * Above `LEAVING` rather than under it, because a fullscreen window covers the
 * space a closing one is shrinking away inside: a departure drawn over it
 * would be a window playing out across a screen that is no longer showing it.
 * It costs the window that *is* closing nothing, because a fullscreen window
 * that closes takes its workspace's fullscreen with it — see
 * `workspace.ts` — so there is never one left over it to hide it.
 */
const FULLSCREEN = 2000;

/**
 * Everything the screen shows, fullscreen included.
 *
 * **A fullscreen window is one window over the workspace rather than the
 * workspace replaced by one window.** The tiling and the floats are laid out
 * the way they always are and the window filling the screen is put over them
 * at {@link FULLSCREEN}; the only thing that is different about the screenful
 * is that one window's rectangle.
 *
 * Which is what makes taking the screen and giving it back a movement. The
 * boxes ease — see `settlingStyles` — so the window grows out of the place it
 * had and shrinks back into it, and the windows it covers are drawn the whole
 * way, disappearing behind it as it arrives rather than a frame before it
 * starts. A screenful holding the fullscreen window alone blinked every other
 * window out at the first frame and put them all back at the last, which is
 * the desktop showing a state that is neither where it came from nor where it
 * is going.
 *
 * It is the same arithmetic on both sides of the change for the same reason:
 * what is under a fullscreen window *is* what the screen goes back to.
 */
export const placementsOf = (
  state: WindowState,
  geometry: Geometry,
): Screenful => {
  const workspace = workspaceOn(state);
  // `gaps.smartGaps`: a workspace showing one window gets the whole screen.
  const gap = windowsOf(workspace.tiling).length > 1 ? INNER_GAP : 0;
  const { frames, selection, tabs } = framesOf(
    workspace.tiling,
    geometry.workspace,
    gap,
  );
  const laidOut = [
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
  ];
  const full = fullscreen(workspace, geometry);
  // The fullscreen window replaces the rectangle it already had rather than
  // being given a second one.
  const placements =
    full === undefined
      ? laidOut
      : [...laidOut.filter(({ id }) => id !== full.id), full];
  return { placements, selection, tabs };
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
