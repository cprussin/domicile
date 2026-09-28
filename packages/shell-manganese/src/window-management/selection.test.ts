import { describe, expect, it } from "bun:test";

import type { Geometry, Placement } from "./placement";
import { placementsOf, TILED } from "./placement";
import { selectionOf } from "./selection";
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

const desktop = (...actions: readonly WindowAction[]): WindowState =>
  reduce(
    NO_WINDOWS,
    WindowAction.AppAppeared("one", "one"),
    WindowAction.AppAppeared("two", "two"),
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
      depth: TILED,
      dragging: false,
      group: false,
      rect: placementOf(state, "two").frame,
    });
  });

  it("rings the group `focus parent` selected instead", () => {
    expect(selected(desktop(WindowAction.ParentFocused()))).toEqual({
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

  it("keeps to the window being dragged rather than easing after it", () => {
    const state = desktop(WindowAction.FloatToggled());

    expect(selected(state, undefined, appWindowId("two"))?.dragging).toBe(true);
  });

  it("rings nothing around a window filling the screen", () => {
    // A line around the edge of the screen says nothing a fullscreen window
    // does not already, and costs it the pixels along all four sides.
    expect(selected(desktop(), appWindowId("two"))).toBeUndefined();
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
