// The per-screen data the stage draws: the screen's rectangles, its workspace
// and where that workspace's windows go.

import type { Display } from "@domicile-desktop/component-library/display-source";

import { TOP_BAR } from "../top-bar/TopBar";
import type { Float } from "../window-management/floating/float";
import { onScreen } from "../window-management/floating/float";
import type { Geometry, Screenful } from "../window-management/placement";
import { placementsOf } from "../window-management/placement";
import type { Rect } from "../window-management/rect";
import { NodeKind, windowsIn } from "../window-management/tree/node";
import type { WindowState } from "../window-management/window-state";
import type { Workspace } from "../window-management/workspace";
import { fullscreenOn } from "../window-management/workspace";

/** One screen, as the stage draws windows on it. */
export type StageScreen = {
  /** The workspace shown; switches are detected against it. */
  current: string;
  /**
   * The boxes of its floating windows (each holding a window or a group), in
   * page pixels. Floats store positions in their own screen's coordinates, and
   * moves and resizes are converted back.
   */
  floats: readonly Float[];
  /**
   * The fullscreen window or group: whether it is a group, and every window
   * in it. `undefined` if none.
   */
  fullscreen: { group: boolean; windows: readonly string[] } | undefined;
  geometry: Geometry;
  /** The layout of every window on it, and the tabs of any container. */
  screenful: Screenful;
};

/**
 * Screens already laid out, by desk, then the workspace shown, then screen
 * name. By desk because every screen's geometry depends on every display.
 */
export type LaidOut = WeakMap<
  readonly Display[],
  WeakMap<Workspace, Map<string, StageScreen>>
>;

/**
 * Every screen the desktop state has, one render after the host describes it. A
 * screen drawn before the state reducer runs would have no workspace.
 *
 * A screen whose workspace is unchanged comes from `laidOut`, the same object
 * as before, so the stage redraws only the screens that changed.
 */
export const stageScreensOf = (
  { screens, workspaces }: Pick<WindowState, "screens" | "workspaces">,
  desk: readonly Display[],
  laidOut: LaidOut,
): readonly StageScreen[] => {
  const shown = new Map(screens.map(({ current, name }) => [name, current]));
  const named = new Map(workspaces.map((found) => [found.name, found]));
  return desk.flatMap((display) => {
    const current = shown.get(display.name);
    const workspace = current === undefined ? undefined : named.get(current);
    if (current === undefined) {
      return [];
    } else if (workspace === undefined) {
      throw new Error(`shell: no workspace ${current}`);
    } else {
      return [stageScreenOn(display, desk, workspace, laidOut)];
    }
  });
};

/** Screen `display` showing `workspace`, from `laidOut` when it has it. */
const stageScreenOn = (
  display: Display,
  desk: readonly Display[],
  workspace: Workspace,
  laidOut: LaidOut,
): StageScreen => {
  const onDesk =
    laidOut.get(desk) ?? new WeakMap<Workspace, Map<string, StageScreen>>();
  const byScreen = onDesk.get(workspace) ?? new Map<string, StageScreen>();
  const found = byScreen.get(display.name);
  if (found === undefined) {
    const geometry = geometryOf(display, desk);
    const screen = {
      current: workspace.name,
      floats: workspace.floats.map((float) => onScreen(float, geometry.screen)),
      fullscreen: fullscreenOf(workspace),
      geometry,
      screenful: placementsOf(workspace, geometry),
    };
    // A cache, so mutated in place.
    laidOut.set(
      desk,
      onDesk.set(workspace, byScreen.set(display.name, screen)),
    );
    return screen;
  } else {
    return found;
  }
};

const fullscreenOf = (workspace: Workspace): StageScreen["fullscreen"] => {
  const full = fullscreenOn(workspace);
  return full?.tiling.root === undefined
    ? undefined
    : {
        group: full.tiling.root.kind === NodeKind.Container,
        windows: windowsIn(full.tiling.root),
      };
};

/**
 * The rectangles a window can fill on a screen: the workspace (screen minus the
 * bar), `fullscreen` (the whole screen) and `fullscreen global` (every screen).
 */
const geometryOf = (display: Display, desk: readonly Display[]): Geometry => {
  const screen = rectOf(display);
  return {
    desktop: boundingBox(desk),
    name: display.name,
    screen,
    workspace: {
      ...screen,
      height: screen.height - TOP_BAR,
      y: screen.y + TOP_BAR,
    },
  };
};

const rectOf = (display: Display): Rect => ({
  height: display.size[1],
  width: display.size[0],
  x: display.position[0],
  y: display.position[1],
});

/** The union of every screen, which `fullscreen global` fills. */
const boundingBox = (desk: readonly Display[]): Rect => {
  const rects = desk.map((display) => rectOf(display));
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    x,
    y,
  };
};
