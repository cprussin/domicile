import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile-desktop/component-library/display-source";
import { renderHook } from "@testing-library/react";

import type { WindowState } from "../window-management/window-state";
import {
  NO_WINDOWS,
  reduceWindows,
  WindowAction,
} from "../window-management/window-state";
import { useStageScreens } from "./useStageScreens";

const LEFT: Display = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};
const RIGHT: Display = { ...LEFT, name: "right", position: [1920, 0] };
const DESK = [LEFT, RIGHT];

const reduce = (
  state: WindowState,
  ...actions: readonly WindowAction[]
): WindowState => actions.reduce(reduceWindows, state);

/** A window on each screen, with the keyboard on the right one. */
const BOTH = reduce(
  NO_WINDOWS,
  WindowAction.ScreensDescribed(
    DESK.map(({ name, position, size }) => ({
      box: { height: size[1], width: size[0], x: position[0], y: position[1] },
      name,
    })),
  ),
  WindowAction.AppAppeared("kitty", "kitty"),
  WindowAction.ScreenHovered("right"),
  WindowAction.AppAppeared("foot", "foot"),
);

const staged = (state: WindowState) =>
  renderHook(({ now }) => useStageScreens(now, DESK), {
    initialProps: { now: state },
  });

describe("useStageScreens", () => {
  it("lays out each screen's workspace", () => {
    const { result } = staged(BOTH);

    expect(
      result.current.map(({ geometry, screenful }) => [
        geometry.name,
        screenful.placements.map(({ id }) => id),
      ]),
    ).toEqual([
      ["left", ["app:kitty"]],
      ["right", ["app:foot"]],
    ]);
  });

  it("keeps the screens through a change no layout depends on", () => {
    const { rerender, result } = staged(BOTH);
    const before = result.current;

    rerender({
      now: reduce(
        BOTH,
        WindowAction.KeyPressed(),
        WindowAction.ModeSet("resize"),
        WindowAction.LauncherToggled(),
        WindowAction.AppTitled("kitty", "vim"),
      ),
    });

    expect(result.current).toBe(before);
  });

  it("keeps a screen whose workspace did not change", () => {
    const { rerender, result } = staged(BOTH);
    const [left] = result.current;

    rerender({ now: reduce(BOTH, WindowAction.AppAppeared("vim", "vim")) });

    expect(result.current[0]).toBe(left);
    expect(result.current[1]?.screenful.placements).toHaveLength(2);
  });
});
