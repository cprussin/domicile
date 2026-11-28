import { describe, expect, it } from "bun:test";
import type { Seat } from "@domicile-desktop/sdk/desktop/seats";

import { workspacesAgentsAreOn } from "./agent-workspaces";
import type { WindowState } from "./window-state";
import { NO_WINDOWS, reduceWindows, WindowAction } from "./window-state";

const reduce = (
  state: WindowState,
  ...actions: readonly WindowAction[]
): WindowState => actions.reduce(reduceWindows, state);

const seat = (holds: readonly string[]): Seat => ({
  focused: undefined,
  holds,
  id: "agent-3",
  name: "Claude Code",
  pointer: undefined,
  taken: [],
});

/** kitty on workspace 1, foot on workspace 3. */
const onOneAndThree = (): WindowState =>
  reduce(
    NO_WINDOWS,
    WindowAction.AppAppeared("kitty", "kitty"),
    WindowAction.WorkspaceSelected("3"),
    WindowAction.AppAppeared("foot", "foot"),
  );

describe("workspacesAgentsAreOn", () => {
  it("names each workspace with a window an agent holds", () => {
    expect(
      workspacesAgentsAreOn(onOneAndThree(), [seat(["foot"])]),
    ).toStrictEqual(["3"]);
  });

  it("names none before the compositor lists the seats", () => {
    expect(workspacesAgentsAreOn(onOneAndThree(), undefined)).toStrictEqual([]);
  });
});
