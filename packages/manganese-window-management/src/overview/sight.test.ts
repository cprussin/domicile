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

    expect(sight.shown.get("left")).toStrictEqual({
      fading: false,
      showing: false,
      view: { scale: 0.1, x: 100, y: 50 },
    });
    expect(sight.hidden.get("app:kitty")).toStrictEqual({
      placement: KITTY,
      screen: "left",
      seen: {
        fading: false,
        showing: true,
        view: { scale: 0.1, x: 400, y: 50 },
      },
    });
  });

  it("grows the shown workspace back and fades the rest while closing", () => {
    const sight = sightOf([overviewOf(true)]);

    expect(sight.shown.get("left")).toStrictEqual({
      fading: false,
      showing: false,
      view: { scale: 1, x: 0, y: 0 },
    });
    expect(sight.hidden.get("app:kitty")?.seen).toMatchObject({
      fading: true,
      showing: false,
    });
  });
});
