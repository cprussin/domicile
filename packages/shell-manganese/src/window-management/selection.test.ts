import { describe, expect, it } from "bun:test";

import { Axis } from "./direction";
import type { Geometry, Placement } from "./placement";
import { placementsOf, TILED } from "./placement";
import { TITLE_BAR } from "./rect";
import { selectionOf } from "./selection";
import { Layout } from "./tree/node";
import { appWindowId } from "./window";
import type { WindowState } from "./window-state";
import {
  activeIdOf,
  NO_WINDOWS,
  reduceWindows,
  WindowAction,
} from "./window-state";

const GEOMETRY: Geometry = {
  desktop: { height: 1080, width: 1920, x: 0, y: 0 },
  name: "",
  screen: { height: 1080, width: 1920, x: 0, y: 0 },
  workspace: { height: 1048, width: 1920, x: 0, y: 32 },
};

const reduce = (
  state: WindowState,
  ...actions: readonly WindowAction[]
): WindowState => actions.reduce(reduceWindows, state);

// Two windows side by side: a workspace opens its windows as tabs.
const desktop = (...actions: readonly WindowAction[]): WindowState =>
  reduce(
    NO_WINDOWS,
    WindowAction.AppAppeared("one", "one"),
    WindowAction.AppAppeared("two", "two"),
    WindowAction.LayoutSet(Layout.SplitH),
    ...actions,
  );

const selected = (
  state: WindowState,
  fullscreenId?: string,
  draggingId?: string,
) =>
  selectionOf(
    placementsOf(state, GEOMETRY),
    activeIdOf(state),
    fullscreenId,
    draggingId,
  );

describe("selectionOf", () => {
  it("rings the window being worked in, at its whole frame", () => {
    const state = desktop();

    expect(selected(state)).toEqual({
      bar: placementOf(state, "two").bar,
      depth: TILED,
      dragging: false,
      group: false,
      rect: placementOf(state, "two").frame,
    });
  });

  it("rises around the open tab alone, rather than the tabs beside it", () => {
    const state = desktop(
      WindowAction.ContainerSplit(Axis.Vertical),
      WindowAction.AppAppeared("three", "three"),
      WindowAction.LayoutSet(Layout.Tabbed),
    );

    expect(selected(state)?.bar).toEqual({
      height: TITLE_BAR,
      width: 473,
      x: 1447,
      y: GEOMETRY.workspace.y,
    });
  });

  it("rings the group `focus parent` selected instead", () => {
    expect(selected(desktop(WindowAction.ParentFocused()))).toEqual({
      bar: { ...GEOMETRY.workspace, height: TITLE_BAR },
      depth: TILED,
      dragging: false,
      group: true,
      rect: GEOMETRY.workspace,
    });
  });

  it("stacks with a floating window, so the floats over it do not hide it", () => {
    const state = desktop(WindowAction.FloatToggled());

    expect(selected(state)?.depth).toBe(placementOf(state, "two").depth);
  });

  it("rings a floating group at its float's depth", () => {
    const state = desktop(
      WindowAction.ContainerSplit(Axis.Vertical),
      WindowAction.AppAppeared("three", "three"),
      WindowAction.ParentFocused(),
      WindowAction.FloatToggled(),
      WindowAction.ParentFocused(),
    );

    expect(selected(state)).toMatchObject({
      depth: placementOf(state, "two").depth,
      group: true,
    });
  });

  it("keeps to the window being dragged rather than easing after it", () => {
    const state = desktop(WindowAction.FloatToggled());

    expect(selected(state, undefined, appWindowId("two"))?.dragging).toBe(true);
  });

  it("rings nothing around a window filling the screen", () => {
    // A line around the edge of the screen says nothing a fullscreen window
    // does not already, and costs it the pixels along all four sides.
    expect(selected(desktop(), appWindowId("two"))).toBeUndefined();
  });

  it("rings no group over a window filling the screen", () => {
    expect(
      selected(desktop(WindowAction.ParentFocused()), appWindowId("two")),
    ).toBeUndefined();
  });

  it("rings nothing around the only window on the workspace", () => {
    // There is nothing else the commands could be pointed at, so the ring says
    // nothing and costs the window the pixels along all four sides.
    expect(
      selected(reduce(NO_WINDOWS, WindowAction.AppAppeared("one", "one"))),
    ).toBeUndefined();
  });

  it("rings nothing around the workspace's only tab group", () => {
    // Its open tab already says which window is open, and there is nothing
    // else on the workspace the commands could be pointed at.
    expect(
      selected(
        reduce(
          NO_WINDOWS,
          WindowAction.AppAppeared("one", "one"),
          WindowAction.AppAppeared("two", "two"),
        ),
      ),
    ).toBeUndefined();
  });

  it("rings the workspace's only tab group once `focus parent` selects it", () => {
    // The commands have moved off the open tab to the group, and nothing else
    // says so.
    expect(
      selected(
        reduce(
          NO_WINDOWS,
          WindowAction.AppAppeared("one", "one"),
          WindowAction.AppAppeared("two", "two"),
          WindowAction.ParentFocused(),
        ),
      ),
    ).toMatchObject({ group: true, rect: GEOMETRY.workspace });
  });

  it("rings nothing while no window is being worked in", () => {
    expect(selected(NO_WINDOWS)).toBeUndefined();
  });
});

const placementOf = (state: WindowState, appId: string): Placement => {
  const placement = placementsOf(state, GEOMETRY).placements.find(
    ({ id }) => id === appWindowId(appId),
  );
  if (placement === undefined) {
    throw new Error(`test: ${appId} is not on screen`);
  } else {
    return placement;
  }
};
