import { describe, expect, it } from "bun:test";

import type { Geometry, Placement } from "../placement";
import { spanning } from "../rect";
import type { StageScreen } from "../screens/stage-screens";
import { framesOf } from "../tree/frames";
import { Layout, LayoutNode } from "../tree/node";
import type { Float } from "./float";
import { castsFloatShadow, floatCovers } from "./float-covers";

const BOX = { height: 600, width: 800, x: 100, y: 100 };

const GEOMETRY: Geometry = {
  desktop: { height: 1080, width: 1920, x: 0, y: 0 },
  name: "",
  screen: { height: 1080, width: 1920, x: 0, y: 0 },
  workspace: { height: 1080, width: 1920, x: 0, y: 0 },
};

/** A float holding `root`, laid out over {@link BOX} at depth 5. */
const screenWith = (root: Float["root"]): StageScreen => {
  const { frames, tabs } = framesOf({ depth: 0, root }, BOX, 0);
  const placements = frames.map(
    (frame): Placement => ({
      ...frame,
      bare: false,
      depth: 5,
      frame: spanning(frame.bar, frame.surface ?? frame.bar),
    }),
  );
  return {
    current: "1",
    floats: [{ ...BOX, bare: false, depth: 0, root, scratchpad: false }],
    fullscreen: undefined,
    geometry: GEOMETRY,
    screenful: {
      focusBox: undefined,
      placements,
      tabs: tabs.map((tab) => ({ ...tab, depth: 5 })),
    },
  };
};

describe("floatCovers", () => {
  it("covers the margin of a group shown in a tab", () => {
    const covers = floatCovers([
      screenWith(
        LayoutNode.Container(Layout.Tabbed, [
          LayoutNode.Container(Layout.SplitH, [
            LayoutNode.Window("a"),
            LayoutNode.Window("b"),
          ]),
        ]),
      ),
    ]);

    expect(covers).toEqual([{ depth: 5, frame: BOX, windows: ["a", "b"] }]);
  });

  it("spans a float's windows", () => {
    const [cover] = floatCovers([
      screenWith(
        LayoutNode.Container(Layout.SplitH, [
          LayoutNode.Window("a"),
          LayoutNode.Window("b"),
        ]),
      ),
    ]);

    expect(cover?.frame).toMatchObject({ width: BOX.width, x: BOX.x });
  });

  it("covers nothing on a fullscreen screen", () => {
    const screen = screenWith(LayoutNode.Window("a"));

    expect(
      floatCovers([
        { ...screen, fullscreen: { group: false, windows: ["a"] } },
      ]),
    ).toEqual([]);
  });
});

describe("castsFloatShadow", () => {
  /** Which of `root`'s wells cast its float's shadow, outer first. */
  const castingIn = (root: Float["root"]): readonly boolean[] => {
    const { floats, screenful } = screenWith(root);
    const [float] = floats;
    return screenful.tabs.flatMap((tab) =>
      tab.well === undefined
        ? []
        : [castsFloatShadow(float, tab, screenful.tabs)],
    );
  };
  const splitOf = (...ids: readonly string[]) =>
    LayoutNode.Container(Layout.SplitV, ids.map(LayoutNode.Window));

  it("casts it from the outermost well, not one inside", () => {
    expect(
      castingIn(
        LayoutNode.Container(Layout.Tabbed, [
          LayoutNode.Container(Layout.Tabbed, [splitOf("a", "b")]),
          LayoutNode.Window("c"),
        ]),
      ),
    ).toEqual([true, false]);
  });

  it("casts it from a well beside the float's other windows", () => {
    expect(
      castingIn(
        LayoutNode.Container(Layout.SplitH, [
          LayoutNode.Window("a"),
          LayoutNode.Container(Layout.Tabbed, [splitOf("b", "c")]),
        ]),
      ),
    ).toEqual([true]);
  });

  it("casts nothing from a tiled well", () => {
    const { screenful } = screenWith(
      LayoutNode.Container(Layout.Tabbed, [splitOf("a", "b")]),
    );

    expect(
      screenful.tabs.map((tab) =>
        castsFloatShadow(undefined, tab, screenful.tabs),
      ),
    ).toEqual([false]);
  });
});
