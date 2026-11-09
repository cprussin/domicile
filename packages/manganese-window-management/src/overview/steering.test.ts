import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { WindowAction } from "../window-state";
import { besideOf, overviewOf } from "./fixture";
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

  it("aims across to the next monitor's workspaces at the edge of its own", () => {
    // Each screen's overview tiles only its own workspaces.
    const [left] = OVERVIEWS;
    if (left === undefined) {
      throw new Error("test: no overview");
    } else {
      const right = besideOf(left);
      const both = [left, right];
      const name = left.screen.geometry.name;

      expect(
        steeredInOverview(
          WindowAction.FocusStepped(Direction.Right),
          both,
          undefined,
          name,
        ),
      ).toStrictEqual(WindowAction.OverviewAimed("5"));
      expect(
        steeredInOverview(
          WindowAction.FocusStepped(Direction.Left),
          both,
          "5",
          name,
        ),
      ).toStrictEqual(WindowAction.OverviewAimed("3"));
      // A swap moves a workspace along its own monitor's bar only.
      expect(
        steeredInOverview(
          WindowAction.WindowStepped(Direction.Right),
          both,
          undefined,
          name,
        ),
      ).toStrictEqual(WindowAction.WindowStepped(Direction.Right));
    }
  });

  it("crosses to another monitor only past the edge of its own, as `focus` does outside it", () => {
    // A smaller monitor to the right, its tiles' middles higher: up from the
    // left one's tiles is no monitor, not the right one's tiles.
    const [left] = OVERVIEWS;
    if (left === undefined) {
      throw new Error("test: no overview");
    } else {
      const beside = besideOf(left);
      const right = {
        ...beside,
        tiles: beside.tiles.map(({ box, name }) => ({
          box: { ...box, y: box.y - 200 },
          name,
        })),
      };
      const name = left.screen.geometry.name;

      expect(
        steeredInOverview(
          WindowAction.FocusStepped(Direction.Up),
          [left, right],
          "1",
          name,
        ),
      ).toStrictEqual(WindowAction.FocusStepped(Direction.Up));
      expect(
        steeredInOverview(
          WindowAction.FocusStepped(Direction.Left),
          [left, right],
          "5",
          name,
        ),
      ).toStrictEqual(WindowAction.OverviewAimed("3"));
    }
  });

  it("leaves every other command as it is", () => {
    expect(steered(WindowAction.LauncherToggled())).toStrictEqual(
      WindowAction.LauncherToggled(),
    );
  });
});
