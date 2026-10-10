import { describe, expect, it } from "bun:test";

import { Axis } from "./direction";
import type { Geometry } from "./placement";
import { contentsOf, LEAVING, placementsOf, raised, TILED } from "./placement";
import { SURFACE_TUCK, TITLE_BAR } from "./rect";
import { Layout } from "./tree/node";
import { appWindowId } from "./window";
import type { WindowState } from "./window-state";
import {
  NO_WINDOWS,
  reduceWindows,
  WindowAction,
  workspaceHere,
} from "./window-state";

const GEOMETRY: Geometry = {
  desktop: { height: 1080, width: 3200, x: 0, y: 0 },
  // The default screen, where `NO_WINDOWS` puts every window.
  name: "",
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
      focusBox: undefined,
      placements: [],
      tabs: [],
    });
  });

  it("marks the windows inside the container `focus parent` selected", () => {
    // `mod+a` with two tiled windows selects the workspace's root container.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.ParentFocused(),
    );

    expect(
      placementsOf(state, GEOMETRY).placements.map(({ selected }) => selected),
    ).toEqual([true, true]);
  });

  it("insets a lone tiled window by the gap at the screen's edges", () => {
    expect(placementFor(desktop("kitty"), "kitty")).toEqual({
      // A tab at most 240 wide, the rest of the strip after it.
      bar: { height: TITLE_BAR, width: 240, x: 20, y: 52 },
      behind: undefined,
      depth: 0,
      frame: { height: 1008, width: 1880, x: 20, y: 52 },
      id: appWindowId("kitty"),
      selected: false,
      soleTab: true,
      strip: {
        at: 0,
        box: { height: TITLE_BAR, width: 1880, x: 20, y: 52 },
        divided: false,
        first: true,
        group: {
          node: { id: appWindowId("kitty"), up: 1 },
          windows: [appWindowId("kitty")],
        },
        open: true,
        rest: 1640,
        tabs: 1,
      },
      surface: {
        height: 1008 - TITLE_BAR + SURFACE_TUCK,
        width: 1880,
        x: 20,
        y: 52 + TITLE_BAR - SURFACE_TUCK,
      },
      // The workspace's tab group, holding one tab.
      tabbed: Layout.Tabbed,
    });
  });

  it("puts the config's gap between two of them and around them", () => {
    // `gaps.inner = 20` between them and at the screen's edges: 1860 is
    // shared and the second starts 20 past the first.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.SplitH),
    );
    expect(placementFor(state, "kitty")?.frame).toEqual({
      height: 1008,
      width: 930,
      x: 20,
      y: 52,
    });
    expect(placementFor(state, "editor")?.frame).toEqual({
      height: 1008,
      width: 930,
      x: 970,
      y: 52,
    });
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

  it("puts a float where it is on its own screen, wherever that screen is", () => {
    // A float is in screen pixels, and this screen is offset in the page.
    const state = reduce(desktop("kitty"), WindowAction.FloatToggled());
    const right = { ...GEOMETRY.screen, x: 1920 };

    const { placements } = placementsOf(state, {
      ...GEOMETRY,
      screen: right,
      workspace: { ...GEOMETRY.workspace, x: 1920 },
    });

    expect(placements.map(({ frame }) => frame.x)).toEqual(
      workspaceHere(state).floats.map(({ x }) => 1920 + x),
    );
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

  // A window's open tab is drawn just over it, so it must stay under the next
  // window up.
  it("leaves a depth free over each window for its open tab", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FloatToggled(),
      WindowAction.WindowSelected(appWindowId("kitty")),
      WindowAction.FloatToggled(),
    );

    const front = placementFor(state, "kitty")?.depth ?? 0;
    const behind = placementFor(state, "editor")?.depth ?? 0;
    expect(raised(TILED)).toBeLessThan(behind);
    expect(raised(behind)).toBeLessThan(front);
  });

  it("lays a floating group out inside its box, all at one depth", () => {
    // `mod+a` then `mod+Shift+Tab` over a vertical split floats the split
    // whole.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.ContainerSplit(Axis.Vertical),
      WindowAction.AppAppeared("mail", "mail"),
      WindowAction.ParentFocused(),
      WindowAction.FloatToggled(),
    );
    const editor = placementFor(state, "editor");
    const mail = placementFor(state, "mail");

    expect(editor?.depth).toBeGreaterThan(TILED);
    expect(mail?.depth).toBe(editor?.depth);
    expect(mail?.frame.x).toBe(editor?.frame.x);
    // The floating gap is narrower than the tiling's.
    const gap =
      (mail?.frame.y ?? 0) -
      ((editor?.frame.y ?? 0) + (editor?.frame.height ?? 0));
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(20);
  });

  it("stacks the tabs of a floating group with the group", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.ContainerSplit(Axis.Vertical),
      WindowAction.AppAppeared("mail", "mail"),
      WindowAction.ParentFocused(),
      WindowAction.ParentFocused(),
      WindowAction.FloatToggled(),
    );

    expect(placementsOf(state, GEOMETRY).tabs).toMatchObject([
      { depth: placementFor(state, "editor")?.depth },
    ]);
  });

  it("fills the screen with a fullscreen window", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FullscreenToggled(false),
    );

    expect(placementFor(state, "editor")?.surface).toMatchObject({
      height: 1080 - TITLE_BAR + SURFACE_TUCK,
      width: 1920,
      x: 0,
      y: TITLE_BAR - SURFACE_TUCK,
    });
  });

  // Fullscreen leaves the other windows placed, so they stay drawn while it
  // animates over them.
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

  // Fullscreen is above `LEAVING`, so a closing window does not animate over
  // it.
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

    // A lone window in a tabbed container: its tab is its title bar.
    expect(placementsOf(state, GEOMETRY).tabs).toEqual([]);
    expect(placementFor(state, "kitty")?.bar).toMatchObject({ y: 52 });
  });
  // `frame` spans the bar and contents, so both scale about one center.
  it("gives every window the box its bar and its contents span together", () => {
    expect(placementFor(desktop("kitty"), "kitty")?.frame).toEqual({
      height: 1008,
      width: 1880,
      x: 20,
      y: 52,
    });
  });

  it("gives a window a tab is hiding the box of the tab alone", () => {
    // A hidden tab has no contents on screen, so its frame is the tab.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.Tabbed),
    );
    const hidden = placementFor(state, "kitty");

    expect(hidden?.surface).toBeUndefined();
    expect(hidden?.frame).toEqual(hidden?.bar ?? GEOMETRY.screen);
  });

  it("carries which way a tiled window's tabs run through to its placement", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.Tabbed),
    );

    expect(placementFor(state, "kitty")?.tabbed).toBe(Layout.Tabbed);
  });

  // A hidden tab is drawn under the shown one, so it is ready when switched
  // to. See `Placement.behind`.
  it("draws a window a tab is hiding under the one it shows", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.Tabbed),
    );
    const shown = placementFor(state, "editor");

    const covered = contentsOf(placementFor(state, "kitty"));

    expect(covered?.rect).toEqual(shown?.surface ?? GEOMETRY.screen);
    expect(covered?.depth ?? TILED).toBeLessThan(TILED);
    expect(contentsOf(shown)).toEqual({
      depth: TILED,
      rect: shown?.surface ?? GEOMETRY.screen,
    });
  });

  // A tab switch holds the outgoing tab at -1 while the new one fades in
  // (`windowConcealing`). At the hidden-tab depth, another hidden tab could
  // draw over it and show through.
  it("leaves a depth free between the hidden tabs and the tiled windows", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.Tabbed),
    );

    expect(
      contentsOf(placementFor(state, "kitty"))?.depth ?? TILED,
    ).toBeLessThan(TILED - 1);
  });

  it("draws nothing for a window that is not on screen", () => {
    expect(contentsOf(undefined)).toBeUndefined();
  });
});

describe("the focus box", () => {
  const focusBoxOf = (state: WindowState) =>
    placementsOf(state, GEOMETRY).focusBox;

  it("is the focused window's frame", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.SplitH),
    );

    expect(focusBoxOf(state)).toMatchObject({
      depth: TILED,
      rect: placementFor(state, "editor")?.frame ?? {},
      windows: [appWindowId("editor")],
    });
  });

  it("spans the whole group `focus parent` selects", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.SplitH),
      WindowAction.ParentFocused(),
    );

    expect(focusBoxOf(state)).toMatchObject({
      rect: { height: 1008, width: 1880, x: 20, y: 52 },
      windows: [appWindowId("kitty"), appWindowId("editor")],
    });
  });

  // The tabs belong to the group, so the box takes them in.
  it("spans a tab group around its focused window, tabs and all", () => {
    // The right half of a split holds the tab group.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.SplitH),
      WindowAction.ContainerSplit(Axis.Vertical),
      WindowAction.AppAppeared("mail", "mail"),
      WindowAction.LayoutSet(Layout.Tabbed),
    );

    expect(focusBoxOf(state)).toEqual({
      depth: TILED,
      rect: { height: 1008, width: 930, x: 970, y: 52 },
      windows: [appWindowId("editor"), appWindowId("mail")],
    });
  });

  it("is a focused float's frame, at its depth", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FloatToggled(),
    );
    const editor = placementFor(state, "editor");

    expect(focusBoxOf(state)).toMatchObject({
      depth: editor?.depth ?? -1,
      rect: editor?.frame ?? {},
      windows: [appWindowId("editor")],
    });
  });

  // A fullscreen window covers the screen, so there is nothing to set apart.
  it("is missing while a window is fullscreen", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FullscreenToggled(false),
    );

    expect(focusBoxOf(state)).toBeUndefined();
  });
});
