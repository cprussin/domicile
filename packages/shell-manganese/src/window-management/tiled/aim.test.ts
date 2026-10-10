import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { Layout } from "../tree/node";
import type { TabTarget } from "./aim";
import { Aim, aimAt, cornerOf } from "./aim";

const LEFT = { frame: { height: 400, width: 500, x: 0, y: 0 }, id: "a" };
const RIGHT = { frame: { height: 400, width: 500, x: 500, y: 0 }, id: "b" };
/** A screen below the two with nothing tiled on it. */
const EMPTY = { area: { height: 400, width: 1000, x: 0, y: 500 }, name: "low" };
const TARGETS = { screens: [EMPTY], tabs: [], windows: [LEFT, RIGHT] };

/** Three tabs along the top of a tabbed `ROW`, "a" open over all of it. */
const tabAt = (id: string, at: number): TabTarget => ({
  at,
  id,
  rect: { height: 30, width: 200, x: 200 * at, y: 0 },
  strip: { height: 30, width: 1000, x: 0, y: 0 },
  tabbed: Layout.Tabbed,
});
const ROW = { frame: { height: 400, width: 1000, x: 0, y: 0 }, id: "a" };
const TABS = {
  screens: [],
  tabs: [tabAt("a", 0), tabAt("b", 1), tabAt("c", 2)],
  windows: [ROW],
};

describe("aimAt", () => {
  it("aims at the middle of the window under the pointer", () => {
    expect(aimAt(TARGETS, "a", 750, 200)).toEqual(
      Aim.Window("b", undefined, RIGHT.frame),
    );
  });

  it("aims at the edge of it the pointer is near, and half of it", () => {
    expect(aimAt(TARGETS, "a", 520, 200)).toEqual(
      Aim.Window("b", Direction.Left, {
        height: 400,
        width: 250,
        x: 500,
        y: 0,
      }),
    );
    expect(aimAt(TARGETS, "a", 750, 390)).toEqual(
      Aim.Window("b", Direction.Down, {
        height: 200,
        width: 500,
        x: 500,
        y: 200,
      }),
    );
  });

  it("aims at nothing over the window being dragged", () => {
    expect(aimAt(TARGETS, "a", 250, 200)).toBeUndefined();
  });

  it("aims at all of a screen with nothing tiled on it", () => {
    expect(aimAt(TARGETS, "a", 250, 600)).toEqual(
      Aim.Screen("low", EMPTY.area),
    );
  });

  it("aims at nothing where there is no window", () => {
    expect(aimAt(TARGETS, "a", 250, 450)).toBeUndefined();
  });

  it("aims a window before or after the tab under the pointer, by its half", () => {
    // Over the open window's frame too: the tab wins.
    expect(aimAt(TABS, "x", 550, 10)).toEqual(
      Aim.Window("c", Direction.Right, {
        height: 30,
        width: 100,
        x: 500,
        y: 0,
      }),
    );
    expect(aimAt(TABS, "x", 250, 10)).toEqual(
      Aim.Window("b", Direction.Left, { height: 30, width: 100, x: 200, y: 0 }),
    );
  });

  it("moves a tab along its own strip into the slot under the pointer", () => {
    // Either half of the slot: the tabs are the same size, so the moved tab
    // lands under the pointer.
    expect(aimAt(TABS, "a", 250, 10)).toEqual(
      Aim.Strip("b", Direction.Right, tabAt("b", 1).rect),
    );
    expect(aimAt(TABS, "c", 210, 10)).toEqual(
      Aim.Strip("b", Direction.Left, tabAt("b", 1).rect),
    );
  });

  it("moves a stacked tab up or down its strip", () => {
    const stackedAt = (id: string, at: number): TabTarget => ({
      at,
      id,
      rect: { height: 30, width: 1000, x: 0, y: 30 * at },
      strip: { height: 60, width: 1000, x: 0, y: 0 },
      tabbed: Layout.Stacking,
    });
    const targets = {
      screens: [],
      tabs: [stackedAt("a", 0), stackedAt("b", 1)],
      windows: [],
    };
    expect(aimAt(targets, "a", 500, 40)).toEqual(
      Aim.Strip("b", Direction.Down, stackedAt("b", 1).rect),
    );
    expect(aimAt(targets, "b", 500, 20)).toEqual(
      Aim.Strip("a", Direction.Up, stackedAt("a", 0).rect),
    );
  });

  it("aims a tab above or below a stacked one, by its half", () => {
    const stacked: TabTarget = {
      at: 1,
      id: "b",
      rect: { height: 30, width: 1000, x: 0, y: 30 },
      strip: { height: 60, width: 1000, x: 0, y: 0 },
      tabbed: Layout.Stacking,
    };
    const targets = { screens: [], tabs: [stacked], windows: [] };
    expect(aimAt(targets, "a", 500, 50)).toEqual(
      Aim.Window("b", Direction.Down, {
        height: 15,
        width: 1000,
        x: 0,
        y: 45,
      }),
    );
  });

  it("aims at nothing over the dragged window's own tab", () => {
    expect(aimAt(TABS, "b", 250, 10)).toBeUndefined();
  });
});

describe("cornerOf", () => {
  it("is the corner of the quarter the pointer took hold of", () => {
    expect(cornerOf(LEFT.frame, 100, 300)).toEqual({
      horizontal: Direction.Left,
      vertical: Direction.Down,
    });
    expect(cornerOf(LEFT.frame, 400, 100)).toEqual({
      horizontal: Direction.Right,
      vertical: Direction.Up,
    });
  });
});
