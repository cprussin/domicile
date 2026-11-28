import type { Seat } from "@domicile-desktop/sdk/desktop/seats";

import { heldByAnAgent } from "./held-by-an-agent";
import type { WindowState } from "./window-state";
import { windowsOn } from "./workspace";

/**
 * The names of the workspaces with a window an agent's seat holds: where an
 * agent is working, seen or not, in the order the state keeps them.
 */
export const workspacesAgentsAreOn = (
  state: Pick<WindowState, "workspaces">,
  seats: readonly Seat[] | undefined,
): readonly string[] =>
  state.workspaces
    .filter((workspace) =>
      windowsOn(workspace).some((id) => heldByAnAgent(seats, id)),
    )
    .map(({ name }) => name);
