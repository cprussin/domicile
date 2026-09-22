import { describe, expect, it } from "bun:test";

import { Axis } from "./direction";
import type { Geometry } from "./placement";
import { LEAVING, placementsOf } from "./placement";
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
      frame: { height: 1048, width: 1920, x: 0, y: 32 },
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

  it("fills the screen with a fullscreen window", () => {
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
  });

  // AND LEAVES WHAT IT COVERS WHERE IT WAS. Taking the screen is one window
  // growing over its neighbors, not the workspace emptying: a fullscreen that
  // placed nothing else would blink every other window out in the frame before
  // the growing one had moved at all, and put them back the frame after it had
  // finished shrinking. What is under it is also what the screen goes back to,
  // so it is the same arithmetic either way.
  it("leaves the rest of the workspace laid out under it", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FullscreenToggled(false),
    );

    expect(placementFor(state, "kitty")).toEqual(
      placementFor(desktop("kitty", "editor"), "kitty"),
    );
  });

  it("goes on reporting the tabs it covers", () => {
    const tabbed = reduce(
      desktop("kitty", "editor"),
      WindowAction.ContainerSplit(Axis.Vertical),
      WindowAction.AppAppeared("mail", "mail"),
      WindowAction.ParentFocused(),
      WindowAction.ParentFocused(),
      WindowAction.LayoutSet(Layout.Tabbed),
    );
    const state = reduce(tabbed, WindowAction.FullscreenToggled(false));

    expect(placementsOf(state, GEOMETRY).tabs).toEqual(
      placementsOf(tabbed, GEOMETRY).tabs,
    );
  });

  // OVER EVERY WINDOW ON THE SCREEN, INCLUDING ONE ON ITS WAY OUT. `LEAVING`
  // is the top of everything else the page draws — a window that has closed is
  // raised there so the neighbors easing into the box it had cannot cover it —
  // and a fullscreen window is over that too: it covers the space that window
  // was in, so a departure drawn over it would be a window shrinking away
  // across a screen that is no longer showing it.
  it("stacks a fullscreen window over everything it covers", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FullscreenToggled(false),
    );

    expect(placementFor(state, "editor")?.depth).toBeGreaterThan(LEAVING);
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
  // WHAT BOTH HALVES OF A WINDOW TURN ABOUT. A window is two elements — the
  // bar and the contents under it — and a frame whose halves scaled about
  // their own centers would come apart at the seam, so each of them is given
  // the whole box to turn about instead.
  it("gives every window the box its bar and its contents span together", () => {
    expect(placementFor(desktop("kitty"), "kitty")?.frame).toEqual({
      height: 1048,
      width: 1920,
      x: 0,
      y: 32,
    });
  });

  it("gives a window a tab is hiding the box of the tab alone", () => {
    // There are no contents on screen to span: the tab is the whole of what
    // the window has.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.Tabbed),
    );
    const hidden = placementFor(state, "kitty");

    expect(hidden?.surface).toBeUndefined();
    expect(hidden?.frame).toEqual(hidden?.bar ?? GEOMETRY.screen);
  });
});
