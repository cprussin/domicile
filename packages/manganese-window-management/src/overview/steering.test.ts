import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { WindowAction } from "../window-state";
import { overviewOf } from "./fixture";
import { steeredInOverview } from "./steering";

// Workspaces 1 and 3 side by side, 3 shown.
const OVERVIEWS = [overviewOf(false)];

const steered = (
  action: ReturnType<(typeof WindowAction)[keyof typeof WindowAction]>,
  aim?: string,
) =>
  steeredInOverview(
    action,
    OVERVIEWS,
    aim,
    OVERVIEWS[0]?.screen.geometry.name ?? "",
  );

describe("steeredInOverview", () => {
  it("aims at the next workspace on `focus`, from the shown one", () => {
    expect(steered(WindowAction.FocusStepped(Direction.Left))).toStrictEqual(
      WindowAction.OverviewAimed("1"),
    );
  });

  it("aims on from the workspace aimed at", () => {
    expect(
      steered(WindowAction.FocusStepped(Direction.Right), "1"),
    ).toStrictEqual(WindowAction.OverviewAimed("3"));
  });

  it("swaps the workspace aimed at with the next one on `move`", () => {
    expect(steered(WindowAction.WindowStepped(Direction.Left))).toStrictEqual(
      WindowAction.WorkspacesSwapped("3", "1"),
    );
  });

  it("leaves a step past the edge, which the overview ignores", () => {
    expect(steered(WindowAction.FocusStepped(Direction.Right))).toStrictEqual(
      WindowAction.FocusStepped(Direction.Right),
    );
  });

  it("leaves every other command as it is", () => {
    expect(steered(WindowAction.LauncherToggled())).toStrictEqual(
      WindowAction.LauncherToggled(),
    );
  });
});
