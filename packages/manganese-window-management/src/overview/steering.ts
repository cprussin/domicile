// The overview's own keys: `focus` and `move` commands, which do nothing to
// windows while it is open, step between its workspaces and swap them.

import type { Direction } from "../direction";
import { screenToward } from "../screens/screen-toward";
import type { WindowAction } from "../window-state";
import { WindowAction as Action, WindowActionKind } from "../window-state";
import type { ScreenOverview } from "./overview";
import type { OverviewTile } from "./tiles";
import { tileToward } from "./tiles";

/**
 * `action` as the open overview takes it. `focus <way>` aims at the next
 * workspace that way, on to the next monitor past the edge of its own (see
 * {@link aimedToward}). `move <way>` swaps the workspace aimed at with the next one
 * that way on its own monitor.
 * Steps from `aim`, or the shown workspace of the `focused` screen. Every
 * other command is left as it is, for the reducer, which ignores those that
 * change windows (see `SHUT_IN_OVERVIEW`).
 */
export const steeredInOverview = (
  action: WindowAction,
  overviews: readonly ScreenOverview[],
  aim: string | undefined,
  focused: string,
): WindowAction => {
  const overview =
    overviews.find(({ tiles }) => tiles.some(({ name }) => name === aim)) ??
    overviews.find(({ screen }) => screen.geometry.name === focused);
  if (overview === undefined) {
    return action;
  } else {
    const from = aim ?? overview.screen.current;
    switch (action.kind) {
      case WindowActionKind.FocusStepped: {
        const to = aimedToward(overviews, from, action.direction);
        return to === undefined ? action : Action.OverviewAimed(to.name);
      }
      case WindowActionKind.WindowStepped: {
        const to = tileToward(overview.tiles, from, action.direction);
        return to === undefined
          ? action
          : Action.WorkspacesSwapped(from, to.name);
      }
      default: {
        return action;
      }
    }
  }
};

/**
 * The tile `direction` of workspace `from`'s in `overviews`: on its own
 * monitor, or past that monitor's edge, the nearest on the monitor `focus`
 * steps to outside the overview (see `screenToward`). `undefined` for none.
 */
export const aimedToward = (
  overviews: readonly ScreenOverview[],
  from: string,
  direction: Direction,
): OverviewTile | undefined => {
  const here = overviews.find(({ tiles }) =>
    tiles.some(({ name }) => name === from),
  );
  const start = here?.tiles.find(({ name }) => name === from);
  if (here === undefined || start === undefined) {
    return undefined;
  } else {
    const next = screenToward(
      overviews.map(({ screen }) => ({
        box: screen.geometry.screen,
        name: screen.geometry.name,
      })),
      here.screen.geometry.name,
      direction,
    );
    const there = overviews.find(({ screen }) => screen.geometry.name === next);
    return (
      tileToward(here.tiles, from, direction) ??
      (there === undefined
        ? undefined
        : tileToward([start, ...there.tiles], from, direction))
    );
  }
};
