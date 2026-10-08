import { describe, expect, it } from "bun:test";

import { inserted, insertedNode } from "./insert";
import { Layout, LayoutNode } from "./node";
import {
  focusedIdOf,
  focusedNodeOf,
  focusedParent,
  NOTHING_TILED,
  windowsOf,
  withFocusOn,
} from "./tiling";

const tiled = (...ids: readonly string[]) =>
  ids.reduce((tiling, id) => inserted(tiling, id), NOTHING_TILED);

/** A window beside a column of two, with focus on the column's first. */
const NESTED = {
  depth: 2,
  root: LayoutNode.Container(
    Layout.SplitH,
    [
      LayoutNode.Window("a"),
      LayoutNode.Container(Layout.SplitV, [
        LayoutNode.Window("b"),
        LayoutNode.Window("c"),
      ]),
    ],
    1,
  ),
};

describe("inserted", () => {
  it("opens the first window in a tab group", () => {
    // sway's `workspace_layout tabbed`, the desktop's default. A group from
    // the start shows where the next window goes.
    const tiling = inserted(NOTHING_TILED, "a");

    expect(tiling.root).toEqual(
      LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
    );
    expect(focusedIdOf(tiling)).toBe("a");
  });

  it("opens the second window in the first one's tab group", () => {
    expect(tiled("a", "b").root).toMatchObject({
      children: [{ id: "a" }, { id: "b" }],
      layout: Layout.Tabbed,
    });
  });

  it("keeps a group arriving on an empty workspace as it is", () => {
    const column = LayoutNode.Container(Layout.SplitV, [
      LayoutNode.Window("a"),
      LayoutNode.Window("b"),
    ]);

    expect(insertedNode(NOTHING_TILED, column).root).toEqual(column);
  });

  it("puts a new window beside the one being worked in", () => {
    const tiling = withFocusOn(tiled("a", "b", "c"), "a");

    expect(windowsOf(inserted(tiling, "d"))).toEqual(["a", "d", "b", "c"]);
  });

  it("focuses what it opened", () => {
    expect(focusedIdOf(tiled("a", "b"))).toBe("b");
  });

  it("opens in the container holding the window being worked in", () => {
    const opened = inserted(NESTED, "d");

    expect(opened.root).toMatchObject({
      children: [{}, { children: [{}, {}, {}] }],
    });
    expect(windowsOf(opened)).toEqual(["a", "b", "d", "c"]);
  });

  it("opens inside the container `focus parent` selected", () => {
    // With focus on the outer container, the window lands beside the column.
    const opened = inserted(focusedParent(focusedParent(NESTED)), "d");

    expect(opened.root).toMatchObject({
      children: [{}, { children: [{}, {}] }, {}],
    });
  });

  it("shares the container out evenly between what is in it", () => {
    expect(tiled("a", "b", "c").root).toMatchObject({
      fractions: [1 / 3, 1 / 3, 1 / 3],
    });
  });

  it("leaves the focus on the window rather than on its container", () => {
    expect(focusedNodeOf(inserted(tiled("a", "b"), "c"))).toEqual(
      LayoutNode.Window("c"),
    );
  });
});
