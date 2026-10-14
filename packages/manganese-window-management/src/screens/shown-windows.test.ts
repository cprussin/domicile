import { describe, expect, it } from "bun:test";
import { ShownWindow } from "@domicile-desktop/component-library/shown-windows";

import type { Placement } from "../placement";
import { shownWindowsOf } from "./shown-windows";
import type { StageScreen } from "./stage-screens";

const RECT = { height: 1080, width: 1920, x: 0, y: 0 };

const SURFACE = { height: 770, width: 1200, x: 0, y: 62 };

/** Window `id` placed with a bar over `surface`, or a hidden tab's bar. */
const placementOf = (id: string, surface: Placement["surface"]): Placement => ({
  bar: { height: 30, width: 1200, x: 0, y: 32 },
  bare: false,
  behind: undefined,
  depth: 0,
  frame: { height: 800, width: 1200, x: 0, y: 32 },
  id,
  selected: false,
  soleTab: false,
  strip: undefined,
  surface,
  tabbed: undefined,
});

/** A screen showing `placements`. */
const screenOf = (placements: readonly Placement[]): StageScreen => ({
  current: "1",
  floats: [],
  fullscreen: undefined,
  geometry: { desktop: RECT, name: "screen", screen: RECT, workspace: RECT },
  screenful: { focusBox: undefined, placements, tabs: [] },
});

describe("shownWindowsOf", () => {
  it("crops a client's window to its contents, leaving out its bar", () => {
    expect(
      shownWindowsOf([screenOf([placementOf("app:term", SURFACE)])]),
    ).toStrictEqual([ShownWindow.App("term", SURFACE)]);
  });

  it("crops a browser window to its contents, leaving out its bar", () => {
    expect(
      shownWindowsOf([screenOf([placementOf("browser:7", SURFACE)])]),
    ).toStrictEqual([ShownWindow.Browser("7", SURFACE)]);
  });

  it("leaves out a hidden tab", () => {
    expect(
      shownWindowsOf([screenOf([placementOf("app:term", undefined)])]),
    ).toStrictEqual([]);
  });
});
