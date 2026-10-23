import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { Layout } from "../tree/node";
import type { TabTarget } from "./aim";
import { Aim, aimAt, cornerOf, tabAimAt } from "./aim";

const LEFT = { frame: { height: 400, width: 500, x: 0, y: 0 }, id: "a" };
const RIGHT = { frame: { height: 400, width: 500, x: 500, y: 0 }, id: "b" };
/** A screen below the two with nothing tiled on it. */
const EMPTY = { area: { height: 400, width: 1000, x: 0, y: 500 }, name: "low" };
const TARGETS = {
  floats: [],
  screens: [EMPTY],
  tabs: [],
  windows: [LEFT, RIGHT],
};

/** Three tabs along the top of a tabbed `ROW`, "a" open over all of it. */
const tabAt = (id: string, at: number): TabTarget => ({
  at,
  depth: 0,
  id,
  rect: { height: 30, width: 200, x: 200 * at, y: 0 },
  strip: { height: 30, width: 1000, x: 0, y: 0 },
  tabbed: Layout.Tabbed,
});
const ROW = { frame: { height: 400, width: 1000, x: 0, y: 0 }, id: "a" };
const TABS = {
  floats: [],
  screens: [],
  tabs: [tabAt("a", 0), tabAt("b", 1), tabAt("c", 2)],
  windows: [ROW],
};

describe("aimAt", () => {
  describe("with a floating group over the windows", () => {
    /** A float over "a" and "b", its strip's one tab "f" at its top. */
    const FLOAT = {
      depth: 2,
      frame: { height: 300, width: 400, x: 300, y: 100 },
      windows: ["f"],
    };
    const floatTab = (id: string, at: number, depth: number): TabTarget => ({
      at,
      depth,
      id,
      rect: { height: 30, width: 200, x: 300 + 200 * at, y: 100 },
      strip: { height: 30, width: 400, x: 300, y: 100 },
      tabbed: Layout.Tabbed,
    });
    const FLOATING = {
      ...TARGETS,
      floats: [FLOAT],
      tabs: [floatTab("f", 0, 2)],
    };

    it("aims at its tabs", () => {
      expect(aimAt(FLOATING, ["a"], 350, 110)).toEqual(
        Aim.Window("f", Direction.Left, {
          height: 30,
          width: 100,
          x: 300,
          y: 100,
        }),
      );
    });

    it("aims at nothing under it", () => {
      expect(aimAt(FLOATING, ["a"], 600, 300)).toBeUndefined();
    });

    // A lone float moves under the pointer as it is dragged.
    it("hides nothing from a drag that carries it", () => {
      expect(aimAt(FLOATING, ["f"], 600, 300)).toMatchObject({ id: "b" });
    });

    it("aims at the front one of two strips", () => {
      const front = {
        ...FLOAT,
        depth: 4,
        frame: { ...FLOAT.frame, x: 350 },
        windows: ["g"],
      };
      expect(
        aimAt(
          {
            ...FLOATING,
            floats: [FLOAT, front],
            tabs: [
              floatTab("f", 0, 2),
              {
                ...floatTab("g", 0, 4),
                rect: { height: 30, width: 200, x: 350, y: 100 },
              },
            ],
          },
          ["a"],
          380,
          110,
        ),
      ).toMatchObject({ id: "g" });
    });

    it("aims at nothing for a tab behind another float", () => {
      const front = {
        depth: 4,
        frame: { height: 300, width: 400, x: 200, y: 50 },
        windows: ["g"],
      };
      expect(
        aimAt({ ...FLOATING, floats: [FLOAT, front] }, ["a"], 350, 110),
      ).toBeUndefined();
    });
  });

  it("aims at the middle of the window under the pointer", () => {
    expect(aimAt(TARGETS, ["a"], 750, 200)).toEqual(
      Aim.Window("b", undefined, RIGHT.frame),
    );
  });

  it("aims at the edge of it the pointer is near, and half of it", () => {
    expect(aimAt(TARGETS, ["a"], 520, 200)).toEqual(
      Aim.Window("b", Direction.Left, {
        height: 400,
        width: 250,
        x: 500,
        y: 0,
      }),
    );
    expect(aimAt(TARGETS, ["a"], 750, 390)).toEqual(
      Aim.Window("b", Direction.Down, {
        height: 200,
        width: 500,
        x: 500,
        y: 200,
      }),
    );
  });

  it("aims at nothing over the window being dragged", () => {
    expect(aimAt(TARGETS, ["a"], 250, 200)).toBeUndefined();
  });

  it("aims at all of a screen with nothing tiled on it", () => {
    expect(aimAt(TARGETS, ["a"], 250, 600)).toEqual(
      Aim.Screen("low", EMPTY.area),
    );
  });

  it("aims at nothing where there is no window", () => {
    expect(aimAt(TARGETS, ["a"], 250, 450)).toBeUndefined();
  });

  it("aims a window before or after the tab under the pointer, by its half", () => {
    // Over the open window's frame too: the tab wins.
    expect(aimAt(TABS, ["x"], 550, 10)).toEqual(
      Aim.Window("c", Direction.Right, {
        height: 30,
        width: 100,
        x: 500,
        y: 0,
      }),
    );
    expect(aimAt(TABS, ["x"], 250, 10)).toEqual(
      Aim.Window("b", Direction.Left, { height: 30, width: 100, x: 200, y: 0 }),
    );
  });

  it("moves a tab along its own strip into the slot under the pointer", () => {
    // Either half of the slot: the tabs are the same size, so the moved tab
    // lands under the pointer.
    expect(aimAt(TABS, ["a"], 250, 10)).toEqual(
      Aim.Strip("b", Direction.Right, tabAt("b", 1).rect),
    );
    expect(aimAt(TABS, ["c"], 210, 10)).toEqual(
      Aim.Strip("b", Direction.Left, tabAt("b", 1).rect),
    );
  });

  it("moves a stacked tab up or down its strip", () => {
    const stackedAt = (id: string, at: number): TabTarget => ({
      at,
      depth: 0,
      id,
      rect: { height: 30, width: 1000, x: 0, y: 30 * at },
      strip: { height: 60, width: 1000, x: 0, y: 0 },
      tabbed: Layout.Stacking,
    });
    const targets = {
      floats: [],
      screens: [],
      tabs: [stackedAt("a", 0), stackedAt("b", 1)],
      windows: [],
    };
    expect(aimAt(targets, ["a"], 500, 40)).toEqual(
      Aim.Strip("b", Direction.Down, stackedAt("b", 1).rect),
    );
    expect(aimAt(targets, ["b"], 500, 20)).toEqual(
      Aim.Strip("a", Direction.Up, stackedAt("a", 0).rect),
    );
  });

  it("aims a tab above or below a stacked one, by its half", () => {
    const stacked: TabTarget = {
      at: 1,
      depth: 0,
      id: "b",
      rect: { height: 30, width: 1000, x: 0, y: 30 },
      strip: { height: 60, width: 1000, x: 0, y: 0 },
      tabbed: Layout.Stacking,
    };
    const targets = { floats: [], screens: [], tabs: [stacked], windows: [] };
    expect(aimAt(targets, ["a"], 500, 50)).toEqual(
      Aim.Window("b", Direction.Down, {
        height: 15,
        width: 1000,
        x: 0,
        y: 45,
      }),
    );
  });

  it("aims at nothing over the dragged window's own tab", () => {
    expect(aimAt(TABS, ["b"], 250, 10)).toBeUndefined();
  });

  it("aims beside the tab group of the window under the pointer, at its edge", () => {
    expect(aimAt(TABS, ["x"], 990, 200)).toEqual(
      Aim.Group("a", Direction.Right, {
        height: 400,
        width: 500,
        x: 500,
        y: 0,
      }),
    );
  });

  it("aims beside a tab group of one at its edge, not into its strip", () => {
    const lone = { ...TABS, tabs: [tabAt("a", 0)] };

    expect(aimAt(lone, ["x"], 990, 200)).toEqual(
      Aim.Group("a", Direction.Right, {
        height: 400,
        width: 500,
        x: 500,
        y: 0,
      }),
    );
  });

  it("aims a tab over its own group at the half of the group it is in", () => {
    // Beside the group, through one of its other tabs, since this one leaves.
    expect(aimAt(TABS, ["a"], 900, 200)).toEqual(
      Aim.Group("b", Direction.Right, {
        height: 400,
        width: 500,
        x: 500,
        y: 0,
      }),
    );
    expect(aimAt(TABS, ["a"], 500, 210)).toEqual(
      Aim.Group("b", Direction.Down, {
        height: 200,
        width: 1000,
        x: 0,
        y: 200,
      }),
    );
  });

  it("aims a dragged group at nothing inside it, and beside the rest", () => {
    // The group is the strip of "a", "b" and "c": its tabs and the window
    // they open over.
    expect(aimAt(TABS, ["a", "b", "c"], 250, 10)).toBeUndefined();
    expect(aimAt(TABS, ["a", "b", "c"], 500, 200)).toBeUndefined();
    expect(aimAt(TARGETS, ["a", "x"], 750, 200)).toEqual(
      Aim.Window("b", undefined, RIGHT.frame),
    );
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

// A lone float moves as it is dragged, and joins a group only over its tabs.
describe("tabAimAt", () => {
  it("aims beside the tab under the pointer", () => {
    expect(tabAimAt(TABS, ["f"], 250, 10)).toEqual(aimAt(TABS, ["f"], 250, 10));
  });

  it("aims at nothing over a window or a screen", () => {
    expect(tabAimAt(TABS, ["f"], 250, 200)).toBeUndefined();
    expect(tabAimAt(TARGETS, ["f"], 250, 600)).toBeUndefined();
  });
});
