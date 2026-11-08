// The overview's own keys: `focus` and `move` commands, which do nothing to
// windows while it is open, step between its workspaces and swap them.

import type { WindowAction } from "../window-state";
import { WindowAction as Action, WindowActionKind } from "../window-state";
import type { ScreenOverview } from "./overview";
import { tileToward } from "./tiles";

/**
 * `action` as the open overview takes it. `focus <way>` aims at the next
 * workspace that way, and `move <way>` swaps the workspace aimed at with it.
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
        const to = tileToward(overview.tiles, from, action.direction);
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
