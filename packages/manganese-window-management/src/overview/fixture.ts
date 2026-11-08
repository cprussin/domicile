// An overview for the overview's own tests: kitty on workspace 1, foot on
// workspace 3, which is shown, on one 1920x1080 screen.

import type { Geometry } from "../placement";
import { placementsOf } from "../placement";
import type { StageScreen } from "../screens/stage-screens";
import type { WindowState } from "../window-state";
import {
  currentHere,
  NO_WINDOWS,
  reduceWindows,
  WindowAction,
  workspaceHere,
} from "../window-state";
import type { ScreenOverview } from "./overview";
import { screenOverviewsOf } from "./overview";

const RECT = { height: 1080, width: 1920, x: 0, y: 0 };

// The default screen, where `NO_WINDOWS` puts every window.
const GEOMETRY: Geometry = {
  desktop: RECT,
  name: "",
  screen: RECT,
  workspace: { height: 1048, width: 1920, x: 0, y: 32 },
};

export const STATE: WindowState = [
  WindowAction.AppAppeared("kitty", "kitty"),
  WindowAction.WorkspaceSelected("3"),
  WindowAction.AppAppeared("foot", "foot"),
].reduce(reduceWindows, NO_WINDOWS);

/** The default screen as the stage draws it. */
export const SCREEN: StageScreen = {
  current: currentHere(STATE),
  floats: [],
  fullscreen: undefined,
  geometry: GEOMETRY,
  screenful: placementsOf(workspaceHere(STATE), GEOMETRY, 0),
};

/** The overview of {@link SCREEN}. */
export const overviewOf = (closing: boolean): ScreenOverview => {
  const [overview] = screenOverviewsOf(STATE, [SCREEN], closing);
  if (overview === undefined) {
    throw new Error("test: no overview of the screen");
  } else {
    return overview;
  }
};
