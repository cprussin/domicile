import { describe, expect, it } from "bun:test";

import type { Geometry } from "./placement";
import { placementsOf } from "./placement";
import { TITLE_BAR } from "./rect";
import { Layout } from "./tree/node";
import { appWindowId } from "./window";
import type { WindowState } from "./window-state";
import { NO_WINDOWS, reduceWindows, WindowAction } from "./window-state";

const GEOMETRY: Geometry = {
  desktop: { height: 1080, width: 3200, x: 0, y: 0 },
  screen: { height: 1080, width: 1920, x: 0, y: 0 },
  workspace: { height: 1048, width: 1920, x: 0, y: 32 },
};

const reduce = (
  state: WindowState,
  ...actions: readonly WindowAction[]
): WindowState => actions.reduce(reduceWindows, state);

const desktop = (...appIds: readonly string[]): WindowState =>
  reduce(
    NO_WINDOWS,
    ...appIds.map((appId) => WindowAction.AppAppeared(appId, appId)),
  );

const placementFor = (state: WindowState, appId: string) => {
  const { placements } = placementsOf(state, GEOMETRY);
  return placements.find(({ id }) => id === appWindowId(appId));
};

describe("placementsOf", () => {
  it("places nothing on an empty workspace", () => {
    expect(placementsOf(NO_WINDOWS, GEOMETRY)).toEqual({
      placements: [],
      tabs: [],
    });
  });

  it("gives a lone tiled window the whole workspace, with no gaps", () => {
    // `gaps.smartGaps`: a workspace showing one window has nothing to space
    // it away from.
    expect(placementFor(desktop("kitty"), "kitty")).toEqual({
      bar: { height: TITLE_BAR, width: 1920, x: 0, y: 32 },
      depth: 0,
      id: appWindowId("kitty"),
      surface: {
        height: 1048 - TITLE_BAR,
        width: 1920,
        x: 0,
        y: 32 + TITLE_BAR,
      },
    });
  });

  it("puts the config's gap between two of them", () => {
    // `gaps.inner = 20`, so 1900 is shared out and the second starts 20 past
    // the first.
    expect(
      placementFor(desktop("kitty", "editor"), "kitty")?.bar,
    ).toMatchObject({ width: 950, x: 0 });
    expect(
      placementFor(desktop("kitty", "editor"), "editor")?.bar,
    ).toMatchObject({ width: 950, x: 970 });
  });

  it("leaves the windows on other workspaces off the screen", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToWorkspace("2"),
    );

    expect(placementFor(state, "editor")).toBeUndefined();
    expect(placementFor(state, "kitty")).toBeDefined();
  });

  it("stacks the floating windows over the tiled ones", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FloatToggled(),
    );

    expect(placementFor(state, "kitty")?.depth).toBe(0);
    expect(placementFor(state, "editor")?.depth).toBeGreaterThan(0);
  });

  it("stacks each float over the one behind it", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FloatToggled(),
      WindowAction.WindowSelected(appWindowId("kitty")),
      WindowAction.FloatToggled(),
    );

    const front = placementFor(state, "kitty")?.depth ?? 0;
    const behind = placementFor(state, "editor")?.depth ?? 0;
    expect(front).toBeGreaterThan(behind);
  });

  it("fills the screen with a fullscreen window and hides the rest", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FullscreenToggled(false),
    );

    expect(placementFor(state, "editor")?.surface).toMatchObject({
      height: 1080 - TITLE_BAR,
      width: 1920,
      x: 0,
      y: TITLE_BAR,
    });
    expect(placementFor(state, "kitty")).toBeUndefined();
  });

  it("fills every screen when the fullscreen is global", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.FullscreenToggled(true),
    );

    expect(placementFor(state, "kitty")?.surface).toMatchObject({
      width: 3200,
    });
  });

  it("reports the tabs of a tabbed container for the chrome to draw", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FloatToggled(),
      WindowAction.ModeSwapped(),
      WindowAction.LayoutSet(Layout.Tabbed),
    );

    // One window tiled in a tabbed container of its own: its tab *is* its
    // title bar, so there is nothing extra to draw.
    expect(placementsOf(state, GEOMETRY).tabs).toEqual([]);
    expect(placementFor(state, "kitty")?.bar).toMatchObject({ y: 32 });
  });
});
