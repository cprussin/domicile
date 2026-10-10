import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { droppedOn } from "./drop";
import { Layout, LayoutNode } from "./node";
import { removed } from "./remove";
import { focusedIdOf, withFocusOn } from "./tiling";

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
    const dropped = droppedOn(ROW, "a", "c", undefined);

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
      focusedIdOf(removed(droppedOn(visited, "b", "a", undefined), "b")),
    ).toBe("a");
  });

  it("goes beside a window dropped on the edge that runs along its row", () => {
    const dropped = droppedOn(ROW, "a", "c", Direction.Left);

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
    const dropped = droppedOn(ROW, "a", "c", Direction.Up);

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

    expect(droppedOn(pair, "a", "b", Direction.Down).root).toMatchObject({
      children: [LayoutNode.Window("b"), LayoutNode.Window("a")],
      layout: Layout.SplitV,
    });
  });

  it("leaves the tree alone when a window is dropped on itself", () => {
    const tiling = withFocusOn(ROW, "b");

    expect(droppedOn(tiling, "b", "b", Direction.Left)).toBe(tiling);
  });
});
