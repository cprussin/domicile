import { describe, expect, it } from "bun:test";

import { grouped, groupedBelowRoot, groupedRef } from "./grouped";
import { Layout, LayoutNode } from "./node";
import {
  focusedIdOf,
  focusedNodeOf,
  focusedParent,
  withFocusOn,
} from "./tiling";

const tabs = (...children: readonly LayoutNode[]) =>
  LayoutNode.Container(Layout.Tabbed, children);

/** Window `a` alone in a split beside a tab group. */
const ROW = withFocusOn(
  {
    depth: 0,
    root: LayoutNode.Container(
      Layout.SplitH,
      [LayoutNode.Window("a"), tabs(LayoutNode.Window("b"))],
      0,
      [0.3, 0.7],
    ),
  },
  "a",
);

describe("grouped", () => {
  it("puts a window in a split in a tab group of its own", () => {
    expect(grouped(ROW).root).toMatchObject({
      children: [
        { children: [{ id: "a" }], layout: Layout.Tabbed },
        { children: [{ id: "b" }], layout: Layout.Tabbed },
      ],
      fractions: [0.3, 0.7],
      layout: Layout.SplitH,
    });
  });

  it("keeps commands on the window", () => {
    const tiling = grouped(ROW);

    expect(focusedNodeOf(tiling)).toMatchObject({ id: "a" });
    expect(focusedIdOf(tiling)).toBe("a");
  });

  it("keeps a selected container selected", () => {
    expect(focusedNodeOf(grouped(focusedParent(ROW)))).toMatchObject({
      layout: Layout.SplitH,
    });
  });

  it("replaces a split of one with what it holds", () => {
    const tiling = grouped(
      withFocusOn(
        {
          depth: 0,
          root: LayoutNode.Container(Layout.SplitV, [LayoutNode.Window("a")]),
        },
        "a",
      ),
    );

    expect(tiling.root).toMatchObject({
      children: [{ id: "a" }],
      layout: Layout.Tabbed,
    });
    expect(focusedNodeOf(tiling)).toMatchObject({ id: "a" });
  });

  it("selects the group a selected split of one leaves", () => {
    const split = withFocusOn(
      {
        depth: 0,
        root: tabs(
          LayoutNode.Container(Layout.SplitV, [tabs(LayoutNode.Window("a"))]),
          LayoutNode.Window("b"),
        ),
      },
      "a",
    );

    expect(
      focusedNodeOf(grouped(focusedParent(focusedParent(split)))),
    ).toMatchObject({ children: [{ id: "a" }], layout: Layout.Tabbed });
  });

  it("puts a lone window in a tab group", () => {
    const tiling = grouped({ depth: 0, root: LayoutNode.Window("a") });

    expect(tiling.root).toMatchObject({
      children: [{ id: "a" }],
      layout: Layout.Tabbed,
    });
    expect(focusedNodeOf(tiling)).toMatchObject({ id: "a" });
  });

  it("leaves a tree already in groups as it is", () => {
    const tiling = grouped(ROW);

    expect(grouped(tiling)).toBe(tiling);
  });
});

describe("groupedBelowRoot", () => {
  it("leaves a lone window bare", () => {
    // A dialog floats on its own; new windows do not join it.
    const tiling = { depth: 0, root: LayoutNode.Window("a") };

    expect(groupedBelowRoot(tiling)).toBe(tiling);
  });
});

describe("groupedRef", () => {
  it("names the same group once its window is in a group of its own", () => {
    const root = LayoutNode.Container(Layout.SplitV, [
      LayoutNode.Window("a"),
      tabs(LayoutNode.Window("b")),
    ]);

    expect(groupedRef(root, { id: "a", up: 1 })).toEqual({ id: "a", up: 2 });
    expect(groupedRef(root, { id: "a", up: 0 })).toEqual({ id: "a", up: 0 });
  });
});
