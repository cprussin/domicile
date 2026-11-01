import { describe, expect, it } from "bun:test";

import { Axis } from "../direction";
import { laidOut, split, splitToggled } from "./layout";
import { Layout, LayoutNode } from "./node";
import {
  focusedIdOf,
  focusedNodeOf,
  focusedParent,
  NOTHING_TILED,
  withFocusOn,
} from "./tiling";

const ROW = {
  depth: 1,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Window("a"),
    LayoutNode.Window("b"),
  ]),
};

const ONLY = { depth: 0, root: LayoutNode.Window("a") };

describe("split", () => {
  const GROUP = withFocusOn(
    {
      depth: 0,
      root: LayoutNode.Container(Layout.Tabbed, [
        LayoutNode.Window("a"),
        LayoutNode.Window("b"),
      ]),
    },
    "b",
  );

  it("moves the focused window out of its group, to its right", () => {
    expect(split(GROUP, Axis.Horizontal).root).toMatchObject({
      children: [
        { children: [{ id: "a" }], layout: Layout.Tabbed },
        { id: "b" },
      ],
      layout: Layout.SplitH,
    });
  });

  it("moves it below for a vertical split", () => {
    expect(split(GROUP, Axis.Vertical).root).toMatchObject({
      children: [{ children: [{ id: "a" }] }, { id: "b" }],
      layout: Layout.SplitV,
    });
  });

  it("keeps commands on what moved", () => {
    expect(focusedNodeOf(split(GROUP, Axis.Vertical))).toMatchObject({
      id: "b",
    });
  });

  it("moves a selected group out of the group it is a tab of", () => {
    const nested = withFocusOn(
      {
        depth: 0,
        root: LayoutNode.Container(Layout.Tabbed, [
          LayoutNode.Window("a"),
          LayoutNode.Container(Layout.Tabbed, [
            LayoutNode.Window("b"),
            LayoutNode.Window("c"),
          ]),
        ]),
      },
      "b",
    );

    const moved = split(focusedParent(nested), Axis.Horizontal);

    expect(moved.root).toMatchObject({
      children: [{ children: [{ id: "a" }] }, { children: [{}, {}] }],
      layout: Layout.SplitH,
    });
    expect(focusedNodeOf(moved)).toMatchObject({ children: [{}, {}] });
  });

  it("leaves a window alone in its group where it is", () => {
    const group = {
      depth: 1,
      root: LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
    };

    expect(split(group, Axis.Vertical)).toBe(group);
  });

  const GROUPS = {
    depth: 2,
    root: LayoutNode.Container(Layout.SplitH, [
      LayoutNode.Container(Layout.Tabbed, [
        LayoutNode.Window("a"),
        LayoutNode.Window("b"),
      ]),
      LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("c")]),
    ]),
  };

  it("joins the split its group is in when that runs the same way", () => {
    expect(split(GROUPS, Axis.Horizontal).root).toMatchObject({
      children: [{ children: [{ id: "b" }] }, { id: "a" }, {}],
      layout: Layout.SplitH,
    });
  });

  it("leaves a group in a split where it is", () => {
    // Only a tab leaves its group. A split is already split.
    const selected = focusedParent(GROUPS);

    expect(split(selected, Axis.Vertical)).toBe(selected);
  });

  it("has nothing to split on an empty workspace", () => {
    expect(split(NOTHING_TILED, Axis.Horizontal)).toBe(NOTHING_TILED);
  });
});

describe("laidOut", () => {
  it("rearranges the container the focused window is in", () => {
    expect(laidOut(ROW, Layout.Tabbed).root).toMatchObject({
      layout: Layout.Tabbed,
    });
  });

  it("rearranges the container `focus parent` selected", () => {
    const nested = {
      depth: 2,
      root: LayoutNode.Container(Layout.SplitH, [
        LayoutNode.Window("a"),
        LayoutNode.Container(Layout.SplitV, [
          LayoutNode.Window("b"),
          LayoutNode.Window("c"),
        ]),
      ]),
    };

    // With focus on the column, the column becomes a stack, not its row.
    const stacked = laidOut(
      focusedParent(withFocusOn(nested, "b")),
      Layout.Stacking,
    );

    expect(stacked.root).toMatchObject({
      children: [{}, { layout: Layout.Stacking }],
      layout: Layout.SplitH,
    });
  });

  it("leaves the container it rearranged as the selected one", () => {
    // `mod+a mod+s mod+w` turns the stack into tabs; the second key must not
    // act on the window.
    const stacked = laidOut(focusedParent(ROW), Layout.Stacking);

    expect(focusedNodeOf(laidOut(stacked, Layout.Tabbed))).toMatchObject({
      layout: Layout.Tabbed,
    });
  });

  it("merges the groups of a split it turns into tabs", () => {
    const groups = withFocusOn(
      {
        depth: 0,
        root: LayoutNode.Container(Layout.SplitH, [
          LayoutNode.Container(Layout.Tabbed, [
            LayoutNode.Window("a"),
            LayoutNode.Window("b"),
          ]),
          LayoutNode.Container(Layout.Stacking, [LayoutNode.Window("c")]),
        ]),
      },
      "c",
    );

    const merged = laidOut(focusedParent(focusedParent(groups)), Layout.Tabbed);

    expect(merged.root).toMatchObject({
      children: [{ id: "a" }, { id: "b" }, { id: "c" }],
      focused: 2,
      layout: Layout.Tabbed,
    });
    expect(focusedNodeOf(merged)).toMatchObject({ layout: Layout.Tabbed });
  });

  it("gives a workspace of one window the container it needs", () => {
    const tabbed = laidOut(ONLY, Layout.Tabbed);

    expect(tabbed.root).toMatchObject({
      children: [{}],
      layout: Layout.Tabbed,
    });
    expect(focusedIdOf(tabbed)).toBe("a");
  });
});

describe("splitToggled", () => {
  it("turns a row into a column", () => {
    expect(splitToggled(ROW).root).toMatchObject({ layout: Layout.SplitV });
  });

  it("turns a column into a row", () => {
    const column = {
      depth: 1,
      root: LayoutNode.Container(Layout.SplitV, [
        LayoutNode.Window("a"),
        LayoutNode.Window("b"),
      ]),
    };

    expect(splitToggled(column).root).toMatchObject({
      layout: Layout.SplitH,
    });
  });

  it("turns the split around a window alone in its group", () => {
    // The group of one is the window, so the split is what toggles.
    const groups = {
      depth: 2,
      root: LayoutNode.Container(Layout.SplitH, [
        LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
        LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("b")]),
      ]),
    };

    const toggled = splitToggled(groups);

    expect(toggled.root).toMatchObject({ layout: Layout.SplitV });
    expect(focusedNodeOf(toggled)).toMatchObject({ id: "a" });
  });

  it("brings a tabbed container back to a row", () => {
    const tabbed = {
      depth: 1,
      root: LayoutNode.Container(Layout.Tabbed, [
        LayoutNode.Window("a"),
        LayoutNode.Window("b"),
      ]),
    };

    expect(splitToggled(tabbed).root).toMatchObject({
      layout: Layout.SplitH,
    });
  });
});
