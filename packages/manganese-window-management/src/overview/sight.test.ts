import { describe, expect, it } from "bun:test";

import type { Placement } from "../placement";
import type { StageScreen } from "../screens/stage-screens";
import type { ScreenOverview } from "./overview";
import { sightOf } from "./sight";

const SCREEN_BOX = { height: 1000, width: 2000, x: 0, y: 0 };

const SCREEN: StageScreen = {
  current: "1",
  floats: [],
  fullscreen: undefined,
  geometry: {
    desktop: SCREEN_BOX,
    name: "left",
    screen: SCREEN_BOX,
    workspace: SCREEN_BOX,
  },
  screenful: { focusBox: undefined, placements: [], tabs: [] },
};

const KITTY = {
  bar: { height: 30, width: 400, x: 0, y: 0 },
  bare: false,
  behind: undefined,
  depth: 0,
  frame: { height: 400, width: 400, x: 0, y: 0 },
  id: "app:kitty",
  selected: false,
  soleTab: false,
  strip: undefined,
  surface: { height: 370, width: 400, x: 0, y: 30 },
  tabbed: undefined,
} satisfies Placement;

const overviewOf = (closing: boolean): ScreenOverview => ({
  closing,
  others: [{ name: "2", placements: [KITTY] }],
  screen: SCREEN,
  tiles: [
    { box: { height: 100, width: 200, x: 100, y: 50 }, name: "1" },
    { box: { height: 100, width: 200, x: 400, y: 50 }, name: "2" },
  ],
});

describe("sightOf", () => {
  it("shrinks each workspace into its tile", () => {
    const sight = sightOf([overviewOf(false)]);

    expect(sight.shown.get("left")?.view).toStrictEqual({
      scale: 0.1,
      x: 100,
      y: 50,
    });
    expect(sight.hidden.get("app:kitty")).toMatchObject({
      placement: KITTY,
      screen: "left",
      seen: { fading: false, shut: true, view: { scale: 0.1, x: 400, y: 50 } },
    });
  });

  it("pulls back from the shown workspace: the others arrive from where they sit beside it", () => {
    // Workspace 2's tile is 300px right of 1's at a tenth of full size, so at
    // full size it starts 3000px right: past the screen's right edge.
    const sight = sightOf([overviewOf(false)]);

    expect(sight.shown.get("left")?.arriving).toBeUndefined();
    expect(sight.hidden.get("app:kitty")?.seen.arriving).toStrictEqual({
      scale: 1,
      x: 3000,
      y: 0,
    });
  });

  it("pushes back in while closing: the shown workspace fills its screen and the rest leave beside it", () => {
    const sight = sightOf([overviewOf(true)]);

    expect(sight.shown.get("left")).toStrictEqual({
      arriving: undefined,
      fading: false,
      shut: false,
      view: { scale: 1, x: 0, y: 0 },
    });
    expect(sight.hidden.get("app:kitty")?.seen).toStrictEqual({
      arriving: undefined,
      fading: true,
      shut: true,
      view: { scale: 1, x: 3000, y: 0 },
    });
  });

  it("keeps the pointer off the hidden workspaces' windows from the start, so closing restyles none of them", () => {
    // Under the picker while open, then leaving: they never take a press.
    // Shut from the start, the leaving windows' every part need not be
    // restyled in the frame the overview starts closing.
    expect(sightOf([overviewOf(false)]).shown.get("left")?.shut).toBe(false);
    expect(
      sightOf([overviewOf(false)]).hidden.get("app:kitty")?.seen.shut,
    ).toBe(true);
    expect(sightOf([overviewOf(true)]).hidden.get("app:kitty")?.seen.shut).toBe(
      true,
    );
  });
});
