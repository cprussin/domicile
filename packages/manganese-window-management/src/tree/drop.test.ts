import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { droppedOn } from "./drop";
import { Layout, LayoutNode } from "./node";
import {
  focusedIdOf,
  focusedNodeOf,
  focusedParent,
  withFocusOn,
} from "./tiling";

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
  it("joins the window dropped on the middle of in a tab group", () => {
    const dropped = droppedOn(
      ROW,
      { id: "a", up: 0 },
      { id: "c", up: 0 },
      undefined,
    );

    expect(dropped.root).toMatchObject({
      children: [
        { id: "b" },
        {
          children: [{ id: "c" }, { id: "a" }],
          focused: 1,
          layout: Layout.Tabbed,
        },
      ],
      layout: Layout.SplitH,
    });
    expect(focusedIdOf(dropped)).toBe("a");
  });

  it("goes beside a window dropped on the edge that runs along its row", () => {
    const dropped = droppedOn(
      ROW,
      { id: "a", up: 0 },
      { id: "c", up: 0 },
      Direction.Left,
    );

    expect(dropped.root).toMatchObject({
      children: [{ id: "b" }, { id: "a" }, { id: "c" }],
      layout: Layout.SplitH,
    });
    expect(focusedIdOf(dropped)).toBe("a");
  });

  it("splits a window dropped on the edge across its row", () => {
    const dropped = droppedOn(
      ROW,
      { id: "a", up: 0 },
      { id: "c", up: 0 },
      Direction.Up,
    );

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
      droppedOn(pair, { id: "a", up: 0 }, { id: "b", up: 0 }, Direction.Down)
        .root,
    ).toMatchObject({
      children: [{ id: "b" }, { id: "a" }],
      layout: Layout.SplitV,
    });
  });

  it("leaves the tree alone when a window is dropped on itself", () => {
    const tiling = withFocusOn(ROW, "b");

    expect(
      droppedOn(tiling, { id: "b", up: 0 }, { id: "b", up: 0 }, Direction.Left),
    ).toBe(tiling);
  });

  describe("a tab group", () => {
    const TABS = {
      depth: 1,
      root: LayoutNode.Container(Layout.Tabbed, [
        LayoutNode.Window("a"),
        LayoutNode.Window("b"),
        LayoutNode.Window("c"),
      ]),
    };

    it("takes a window dropped beside one of its tabs into its strip", () => {
      expect(
        droppedOn(TABS, { id: "c", up: 0 }, { id: "a", up: 0 }, Direction.Right)
          .root,
      ).toMatchObject({
        children: [{ id: "a" }, { id: "c" }, { id: "b" }],
        layout: Layout.Tabbed,
      });
    });

    it("takes a window dropped on the middle of a tab in after it", () => {
      expect(
        droppedOn(TABS, { id: "c", up: 0 }, { id: "a", up: 0 }, undefined).root,
      ).toMatchObject({
        children: [{ id: "a" }, { id: "c" }, { id: "b" }],
        layout: Layout.Tabbed,
      });
    });

    it("splits with a window dropped on its edge, which leaves it", () => {
      expect(
        droppedOn(TABS, { id: "c", up: 0 }, { id: "a", up: 1 }, Direction.Right)
          .root,
      ).toMatchObject({
        children: [
          {
            children: [{ id: "a" }, { id: "b" }],
            layout: Layout.Tabbed,
          },
          { id: "c" },
        ],
        layout: Layout.SplitH,
      });
    });
  });

  it("splits a tab group of one with a window dropped on any of its edges", () => {
    const lone = {
      depth: 1,
      root: LayoutNode.Container(Layout.SplitV, [
        LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
        LayoutNode.Window("b"),
      ]),
    };

    expect(
      droppedOn(lone, { id: "b", up: 0 }, { id: "a", up: 1 }, Direction.Right)
        .root,
    ).toMatchObject({
      children: [{ id: "a" }, { id: "b" }],
      layout: Layout.SplitH,
    });
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

    it("goes beside a window dropped on its edge", () => {
      const dropped = droppedOn(
        TABS_BESIDE,
        GROUP,
        { id: "c", up: 0 },
        Direction.Right,
      );

      expect(dropped.root).toMatchObject({
        children: [
          { id: "c" },
          {
            children: [{ id: "a" }, { id: "b" }],
            layout: Layout.Tabbed,
          },
        ],
        layout: Layout.SplitH,
      });
    });

    it("focuses its window alone when it was not selected", () => {
      const dropped = droppedOn(
        TABS_BESIDE,
        GROUP,
        { id: "c", up: 0 },
        Direction.Right,
      );

      expect(focusedNodeOf(dropped)).toMatchObject({ id: "a" });
    });

    it("stays selected when it was selected", () => {
      const dropped = droppedOn(
        focusedParent(TABS_BESIDE),
        GROUP,
        { id: "c", up: 0 },
        Direction.Right,
      );

      expect(focusedNodeOf(dropped)).toMatchObject({ layout: Layout.Tabbed });
    });

    it("goes in as a tab of a window dropped on the middle of", () => {
      expect(
        droppedOn(TABS_BESIDE, GROUP, { id: "c", up: 0 }, undefined).root,
      ).toMatchObject({
        children: [{ id: "c" }, { layout: Layout.Tabbed }],
        layout: Layout.Tabbed,
      });
    });

    it("leaves the tree alone when dropped on a window inside it", () => {
      expect(
        droppedOn(TABS_BESIDE, GROUP, { id: "b", up: 0 }, Direction.Left),
      ).toBe(TABS_BESIDE);
    });
  });
});
