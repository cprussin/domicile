import { describe, expect, it } from "bun:test";

import type { PlacedTab, Placement } from "../placement";
import type { StripPlace } from "../tree/frames";
import { Layout } from "../tree/node";
import { tabTargetsOf } from "./tab-targets";

const STRIP = { height: 30, width: 600, x: 0, y: 0 };

/** Slot `at` of a tabbed strip of three over `STRIP`. */
const stripAt = (at: number): StripPlace => ({
  area: { ...STRIP, height: 400 },
  at,
  box: STRIP,
  divided: false,
  end: undefined,
  endDivided: false,
  group: { node: { id: "a", up: 1 }, wells: 0, windows: ["a", "b", "c"] },
  nested: false,
  open: at === 0,
  tabs: 3,
});

const rectAt = (at: number) => ({ height: 30, width: 200, x: 200 * at, y: 0 });

/** Window "a", open in slot 0. */
const WINDOW: Placement = {
  bar: rectAt(0),
  bare: false,
  behind: undefined,
  depth: 0,
  frame: { ...STRIP, height: 400 },
  id: "a",
  selected: false,
  soleTab: false,
  strip: stripAt(0),
  surface: { ...STRIP, height: 370, y: 30 },
  tabbed: Layout.Tabbed,
};

/** A hidden group of "b" and "c" in slot 1, named after "b". */
const GROUP: PlacedTab = {
  active: false,
  depth: 0,
  group: Layout.Tabbed,
  id: "b",
  node: { id: "b", up: 1 },
  rect: rectAt(1),
  selected: false,
  strip: stripAt(1),
  tabbed: Layout.Tabbed,
  well: undefined,
  windows: ["b", "c"],
};

describe("tabTargetsOf", () => {
  it("gives every window's tab and every nested group's tab", () => {
    expect(tabTargetsOf({ placements: [WINDOW], tabs: [GROUP] })).toEqual([
      {
        at: 0,
        depth: 0,
        node: { id: "a", up: 0 },
        rect: rectAt(0),
        strip: STRIP,
        tabbed: Layout.Tabbed,
        windows: ["a"],
      },
      {
        at: 1,
        depth: 0,
        node: { id: "b", up: 1 },
        rect: rectAt(1),
        strip: STRIP,
        tabbed: Layout.Tabbed,
        windows: ["b", "c"],
      },
    ]);
  });

  it("gives none for a window's own bar", () => {
    expect(
      tabTargetsOf({
        placements: [{ ...WINDOW, strip: undefined, tabbed: undefined }],
        tabs: [],
      }),
    ).toEqual([]);
  });
});
