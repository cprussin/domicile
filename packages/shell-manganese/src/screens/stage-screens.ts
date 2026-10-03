// What the stage draws on each screen of the desk: the screen's rectangles, the
// workspace it shows, and where that workspace's windows go.

import type { Display } from "@domicile-desktop/component-library/display-source";

import { TOP_BAR } from "../top-bar/TopBar";
import type { Float } from "../window-management/floating/float";
import { onScreen } from "../window-management/floating/float";
import type { Geometry, Screenful } from "../window-management/placement";
import { placementsOf } from "../window-management/placement";
import type { Rect } from "../window-management/rect";
import type { WindowState } from "../window-management/window-state";
import { currentOn, workspaceOn } from "../window-management/window-state";

/** One screen of the desk, as the stage draws the windows on it. */
export type StageScreen = {
  /** The workspace on it, which is what a switch is noticed against. */
  current: string;
  /**
   * The boxes of its floating windows, each holding one or a group — in this
   * page's pixels, which is where the screen is on it: a float is in its own
   * screen's, and moves and resizes go back into them.
   */
  floats: readonly Float[];
  /** The window filling it, or `undefined` while none is. */
  fullscreenId: string | undefined;
  geometry: Geometry;
  /** Where every window on it goes, and the tabs of any container. */
  screenful: Screenful;
};

/**
 * Every screen the desktop has taken up, which is every display the host
 * described one render later: the desk reaches the state through a reduction,
 * and a screen drawn before that reduction lands would be one with no
 * workspace on it.
 */
export const stageScreensOf = (
  state: WindowState,
  desk: readonly Display[],
): readonly StageScreen[] =>
  desk
    .filter(({ name }) => state.screens.some((screen) => screen.name === name))
    .map((display) => {
      const geometry = geometryOf(display, desk);
      const workspace = workspaceOn(state, display.name);
      return {
        current: currentOn(state, display.name),
        floats: workspace.floats.map((float) =>
          onScreen(float, geometry.screen),
        ),
        fullscreenId: workspace.fullscreen?.id,
        geometry,
        screenful: placementsOf(state, geometry),
      };
    });

/**
 * The rectangles a screen has to offer.
 *
 * Three of them, because a window can be asked to fill any of the three: the
 * workspace is this screen with the bar taken off the top, `fullscreen` is the
 * whole of it, and `fullscreen global` is every screen there is.
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

/** Every screen at once, which is what `fullscreen global` fills. */
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
