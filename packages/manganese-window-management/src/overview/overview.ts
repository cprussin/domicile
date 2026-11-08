// What the overview shows on each screen: a tile for every workspace its bar
// lists, and the hidden ones' windows laid out as they would be shown.

import type { Placement } from "../placement";
import { placementsOf } from "../placement";
import type { Spot } from "../pointer-warp";
import type { Rect } from "../rect";
import type { StageScreen } from "../screens/stage-screens";
import type { WindowState } from "../window-state";
import { workspaceNamed, workspacesOn } from "../window-state";
import type { OverviewTile, View } from "./tiles";
import { inverseOf, seenThrough, tileAt, tilesOf, viewOf } from "./tiles";

/** The overview on one screen. */
export type ScreenOverview = {
  /**
   * Whether it is closing: the shown workspace grows back to fill the screen
   * and the rest fade.
   */
  closing: boolean;
  /** The hidden workspaces' windows, as they would be placed on it. */
  others: readonly { name: string; placements: readonly Placement[] }[];
  screen: StageScreen;
  /** Every workspace its bar lists, the shown one included, in order. */
  tiles: readonly OverviewTile[];
};

/** The overview on each of `screens`. */
export const screenOverviewsOf = (
  state: Pick<WindowState, "homes" | "workspaces">,
  screens: readonly StageScreen[],
  closing: boolean,
): ScreenOverview[] =>
  screens.map((screen) => {
    const { geometry } = screen;
    const names = workspacesOn(state, geometry.name);
    return {
      closing,
      others: names
        .filter((name) => name !== screen.current)
        .map((name) => ({
          name,
          placements: placementsOf(workspaceNamed(state, name), geometry, 0)
            .placements,
        })),
      screen,
      tiles: tilesOf(geometry.workspace, geometry.screen, names),
    };
  });

/**
 * A window in the overview: where it shows, in page pixels, and the
 * workspace it is on.
 */
export type OverviewWindow = { box: Rect; id: string; workspace: string };

/**
 * The window under page point `at` in `overview`, topmost first, or
 * `undefined` over a tile's empty space or between tiles.
 */
export const windowAt = (
  overview: ScreenOverview,
  at: Spot,
): OverviewWindow | undefined => {
  const tile = tileAt(overview.tiles, at);
  const placements =
    tile === undefined ? [] : placementsIn(overview, tile.name);
  const view =
    tile === undefined
      ? undefined
      : viewOf(overview.screen.geometry.screen, tile.box);
  const hit =
    view === undefined
      ? undefined
      : placements
          .toSorted((one, other) => other.depth - one.depth)
          .map(({ frame, id }) => ({ box: seenThrough(view, frame), id }))
          .find(({ box }) => covers(box, at));
  return tile === undefined || hit === undefined
    ? undefined
    : { ...hit, workspace: tile.name };
};

/** The windows `overview` shows on workspace `name`. */
const placementsIn = (
  overview: ScreenOverview,
  name: string,
): readonly Placement[] =>
  name === overview.screen.current
    ? overview.screen.screenful.placements
    : (overview.others.find((other) => other.name === name)?.placements ?? []);

const covers = ({ height, width, x, y }: Rect, [atX, atY]: Spot): boolean =>
  atX >= x && atX < x + width && atY >= y && atY < y + height;

/** The view of `overview`'s shown workspace in its tile. */
export const shownViewOf = ({ screen, tiles }: ScreenOverview): View => {
  const tile = tiles.find(({ name }) => name === screen.current);
  if (tile === undefined) {
    throw new Error(`shell: workspace ${screen.current} has no overview tile`);
  } else {
    return viewOf(screen.geometry.screen, tile.box);
  }
};

/**
 * The camera on `overview`'s shown workspace: the view that fills the screen
 * with its tile. The overview pulls back from it as it opens and pushes back
 * into it as it closes, moving every tile and window together.
 */
export const cameraOf = (overview: ScreenOverview): View =>
  inverseOf(shownViewOf(overview));
