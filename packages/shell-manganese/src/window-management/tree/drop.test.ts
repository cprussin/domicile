import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { droppedOn } from "./drop";
import { Layout, LayoutNode } from "./node";
import { removed } from "./remove";
import { focusedIdOf, focusedNodeOf, withFocusOn } from "./tiling";

const ROW = {
  depth: 1,
  root: LayoutNode.Container(
    Layout.SplitH,
    [LayoutNode.Window("a"), LayoutNode.Window("b"), LayoutNode.Window("c")],
    0,
    [0.2, 0.3, 0.5],
  ),
};

describe("droppedOn", () => {
  it("trades places with the window dropped on the middle of", () => {
    const dropped = droppedOn(ROW, { id: "a", up: 0 }, "c", undefined);

    expect(dropped.root).toEqual(
      LayoutNode.Container(
        Layout.SplitH,
        [
          LayoutNode.Window("c"),
          LayoutNode.Window("b"),
          LayoutNode.Window("a", 1),
        ],
        2,
        [0.2, 0.3, 0.5],
      ),
    );
    expect(focusedIdOf(dropped)).toBe("a");
  });

  it("keeps both windows' focus history when they trade places", () => {
    const visited = withFocusOn(withFocusOn(withFocusOn(ROW, "c"), "a"), "b");

    expect(
      focusedIdOf(
        removed(droppedOn(visited, { id: "b", up: 0 }, "a", undefined), "b"),
      ),
    ).toBe("a");
  });

  it("goes beside a window dropped on the edge that runs along its row", () => {
    const dropped = droppedOn(ROW, { id: "a", up: 0 }, "c", Direction.Left);

    expect(dropped.root).toMatchObject({
      children: [
        LayoutNode.Window("b"),
        LayoutNode.Window("a"),
        LayoutNode.Window("c"),
      ],
      layout: Layout.SplitH,
    });
    expect(focusedIdOf(dropped)).toBe("a");
  });

  it("splits a window dropped on the edge across its row", () => {
    const dropped = droppedOn(ROW, { id: "a", up: 0 }, "c", Direction.Up);

    expect(dropped.root).toMatchObject({
      children: [
        LayoutNode.Window("b"),
        {
          children: [LayoutNode.Window("a", 1), LayoutNode.Window("c")],
          layout: Layout.SplitV,
        },
      ],
    });
    expect(focusedIdOf(dropped)).toBe("a");
  });

  it("splits the workspace when the window dropped on is all that is left", () => {
    const pair = {
      depth: 1,
      root: LayoutNode.Container(Layout.SplitH, [
        LayoutNode.Window("a"),
        LayoutNode.Window("b"),
      ]),
    };

    expect(
      droppedOn(pair, { id: "a", up: 0 }, "b", Direction.Down).root,
    ).toMatchObject({
      children: [LayoutNode.Window("b"), LayoutNode.Window("a")],
      layout: Layout.SplitV,
    });
  });

  it("leaves the tree alone when a window is dropped on itself", () => {
    const tiling = withFocusOn(ROW, "b");

    expect(droppedOn(tiling, { id: "b", up: 0 }, "b", Direction.Left)).toBe(
      tiling,
    );
  });

  describe("a group", () => {
    /** A tab group of "a" and "b" beside "c", focus on "a". */
    const TABS_BESIDE = withFocusOn(
      {
        depth: 0,
        root: LayoutNode.Container(Layout.SplitH, [
          LayoutNode.Container(Layout.Tabbed, [
            LayoutNode.Window("a"),
            LayoutNode.Window("b"),
          ]),
          LayoutNode.Window("c"),
        ]),
      },
      "a",
    );
    const GROUP = { id: "a", up: 1 };

    it("goes beside a window dropped on its edge, and stays selected", () => {
      const dropped = droppedOn(TABS_BESIDE, GROUP, "c", Direction.Right);

      expect(dropped.root).toMatchObject({
        children: [
          LayoutNode.Window("c"),
          {
            children: [LayoutNode.Window("a"), LayoutNode.Window("b")],
            layout: Layout.Tabbed,
          },
        ],
        layout: Layout.SplitH,
      });
      expect(focusedNodeOf(dropped)).toMatchObject({ layout: Layout.Tabbed });
    });

    it("trades places with a window dropped on the middle of", () => {
      expect(droppedOn(TABS_BESIDE, GROUP, "c", undefined).root).toMatchObject({
        children: [LayoutNode.Window("c"), { layout: Layout.Tabbed }],
      });
    });

    it("leaves the tree alone when dropped on a window inside it", () => {
      expect(droppedOn(TABS_BESIDE, GROUP, "b", Direction.Left)).toBe(
        TABS_BESIDE,
      );
    });
  });
});
