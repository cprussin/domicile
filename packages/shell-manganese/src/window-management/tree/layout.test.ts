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
  it("wraps the focused window in a container of its own", () => {
    // Which is what `splitv` does in sway: nothing moves until the next
    // window opens, and then it opens below rather than beside.
    const vertical = split(withFocusOn(ROW, "b"), Axis.Vertical);

    expect(vertical.root).toMatchObject({
      children: [{}, { children: [{}], layout: Layout.SplitV }],
    });
  });

  it("keeps a selected container selected, one level deeper", () => {
    // sway splits whatever `focus parent` is pointed at and leaves it
    // pointed there: the container is inside a new one, and it is still the
    // container the next key acts on.
    const selected = focusedParent(withFocusOn(ROW, "a"));

    expect(focusedNodeOf(split(selected, Axis.Vertical))).toMatchObject({
      children: [{}, {}],
      layout: Layout.SplitH,
    });
  });

  it("leaves the focus on the window inside it", () => {
    expect(focusedNodeOf(split(ROW, Axis.Vertical))).toEqual(
      LayoutNode.Window("a"),
    );
  });

  it("splits a workspace of one window too", () => {
    expect(split(ONLY, Axis.Horizontal).root).toMatchObject({
      children: [{}],
      layout: Layout.SplitH,
    });
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

    // The focus is the column, so it is the column that becomes a stack —
    // not the row it sits in.
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
    // What `mod+a mod+s mod+w` has to be able to mean: a stack laid out
    // again as tabs, rather than the second key acting on the window.
    const stacked = laidOut(focusedParent(ROW), Layout.Stacking);

    expect(focusedNodeOf(laidOut(stacked, Layout.Tabbed))).toMatchObject({
      layout: Layout.Tabbed,
    });
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
