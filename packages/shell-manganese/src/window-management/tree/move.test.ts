import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { movedBy } from "./move";
import { Layout, LayoutNode } from "./node";
import {
  focusedIdOf,
  focusedNodeOf,
  NOTHING_TILED,
  windowsOf,
  withFocusOn,
} from "./tiling";

const ROW = {
  depth: 1,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Window("a"),
    LayoutNode.Window("b"),
    LayoutNode.Window("c"),
  ]),
};

/** A window beside a column of two, the column last used at its foot. */
const NESTED = {
  depth: 2,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Window("a"),
    LayoutNode.Container(
      Layout.SplitV,
      [LayoutNode.Window("b"), LayoutNode.Window("c")],
      1,
    ),
  ]),
};

/** A column of two beside a window, which the window is moved back into. */
const NESTED_LEFT = {
  depth: 2,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Container(
      Layout.SplitV,
      [LayoutNode.Window("b"), LayoutNode.Window("c")],
      1,
    ),
    LayoutNode.Window("a"),
  ]),
};

/** Three windows sharing a row unevenly, the middle one a column of two. */
const RESIZED_ROW = {
  depth: 1,
  root: LayoutNode.Container(
    Layout.SplitH,
    [
      LayoutNode.Window("a"),
      LayoutNode.Container(Layout.SplitV, [
        LayoutNode.Window("c"),
        LayoutNode.Window("d"),
      ]),
      LayoutNode.Window("b"),
    ],
    0,
    [0.2, 0.6, 0.2],
  ),
};

/** A window beside a tabbed container of two, open at its second tab. */
const TABBED = {
  depth: 2,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Window("a"),
    LayoutNode.Container(
      Layout.Tabbed,
      [LayoutNode.Window("b"), LayoutNode.Window("c")],
      1,
    ),
  ]),
};

describe("movedBy", () => {
  it("moves a window past its neighbor", () => {
    const moved = movedBy(withFocusOn(ROW, "b"), Direction.Right);

    expect(windowsOf(moved)).toEqual(["a", "c", "b"]);
  });

  it("keeps the focus on the window it moved", () => {
    expect(focusedIdOf(movedBy(withFocusOn(ROW, "b"), Direction.Left))).toBe(
      "b",
    );
  });

  it("stays put against the edge of the workspace", () => {
    const tiling = withFocusOn(ROW, "c");

    expect(movedBy(tiling, Direction.Right)).toBe(tiling);
  });

  it("splits the workspace the other way to move across it", () => {
    // What i3 does with a window moved perpendicular to its container: the
    // workspace gains a split of the other orientation and the window goes to
    // that side of everything.
    const moved = movedBy(withFocusOn(ROW, "a"), Direction.Down);

    expect(moved.root).toMatchObject({ layout: Layout.SplitV });
    expect(windowsOf(moved)).toEqual(["b", "c", "a"]);
  });

  it("moves a window out of the container it is in", () => {
    const moved = movedBy(withFocusOn(NESTED, "b"), Direction.Left);

    expect(windowsOf(moved)).toEqual(["a", "b", "c"]);
    expect(moved.root).toMatchObject({ children: [{}, {}, {}] });
  });

  it("moves a window into the container beside it", () => {
    // sway's own: a window pushed at a container joins it rather than
    // swapping past it, which is what a split and a move make a group with.
    const moved = movedBy(withFocusOn(NESTED, "a"), Direction.Right);

    // Beside the child that container last had the focus in, and on the side
    // the window came from.
    expect(windowsOf(moved)).toEqual(["b", "a", "c"]);
    expect(focusedIdOf(moved)).toBe("a");
    // What it left behind is one container of one, which is its only child.
    expect(moved.root).toMatchObject({ layout: Layout.SplitV });
  });

  it("enters a container running its way at the edge it came from", () => {
    // A tabbed container runs left and right, so a window pushed into one
    // from its left becomes the first tab rather than landing beside the tab
    // that is open.
    const moved = movedBy(withFocusOn(TABBED, "a"), Direction.Right);

    expect(windowsOf(moved)).toEqual(["a", "b", "c"]);
    expect(moved.root).toMatchObject({ layout: Layout.Tabbed });
  });

  it("enters a container it is moved back into from the other side", () => {
    // The same rule read the other way: the window comes in on the side it
    // came from, which for a column it is pushed *into* from the right is
    // under the window that column last had the focus in.
    const moved = movedBy(withFocusOn(NESTED_LEFT, "a"), Direction.Left);

    expect(windowsOf(moved)).toEqual(["b", "c", "a"]);
  });

  it("enters a tabbed container it is moved back into at its last tab", () => {
    const tabbed = {
      depth: 2,
      root: LayoutNode.Container(Layout.SplitH, [
        LayoutNode.Container(Layout.Tabbed, [
          LayoutNode.Window("b"),
          LayoutNode.Window("c"),
        ]),
        LayoutNode.Window("a"),
      ]),
    };

    expect(
      windowsOf(movedBy(withFocusOn(tabbed, "a"), Direction.Left)),
    ).toEqual(["b", "c", "a"]);
  });

  it("goes on into the container the one it entered is showing", () => {
    // sway asks the same question again of whatever the container it entered
    // last had the focus in — `container_move_to_container_from_direction`
    // calls itself — so a column showing a row the window is moving along
    // takes it into that row rather than beside it.
    const deep = {
      depth: 1,
      root: LayoutNode.Container(Layout.SplitH, [
        LayoutNode.Window("a"),
        LayoutNode.Container(Layout.SplitV, [
          LayoutNode.Container(Layout.SplitH, [
            LayoutNode.Window("b"),
            LayoutNode.Window("c"),
          ]),
          LayoutNode.Window("d"),
        ]),
      ]),
    };

    const moved = movedBy(withFocusOn(deep, "a"), Direction.Right);

    // At the near end of that row, which is the side it came from.
    expect(windowsOf(moved)).toEqual(["a", "b", "c", "d"]);
    expect(moved.root).toMatchObject({
      children: [{ children: [{}, {}, {}] }, {}],
      layout: Layout.SplitV,
    });
  });

  it("gives the row the window left its share back", () => {
    // What a closed window's container does with the space, because that is
    // what this is: the row lost a child and nothing was put into it. The
    // windows that are left keep their sizes relative to each other.
    const moved = movedBy(withFocusOn(RESIZED_ROW, "a"), Direction.Right);

    expect(windowsOf(moved)).toEqual(["a", "c", "d", "b"]);
    // The column had 0.6 of the row and `b` 0.2, which is three to one.
    expect(moved.root).toMatchObject({
      fractions: [expect.closeTo(0.75), expect.closeTo(0.25)],
    });
  });

  it("moves a selected container into the container beside it", () => {
    const row = {
      depth: 1,
      root: LayoutNode.Container(Layout.SplitH, [
        LayoutNode.Container(Layout.SplitV, [
          LayoutNode.Window("a"),
          LayoutNode.Window("b"),
        ]),
        LayoutNode.Container(Layout.SplitV, [
          LayoutNode.Window("c"),
          LayoutNode.Window("d"),
        ]),
      ]),
    };

    const moved = movedBy(row, Direction.Right);

    // The whole column, in among the two windows of the one it was moved at.
    expect(windowsOf(moved)).toEqual(["a", "b", "c", "d"]);
    expect(moved.root).toMatchObject({
      children: [{ children: [{}, {}] }, {}, {}],
      layout: Layout.SplitV,
    });
  });

  it("keeps a container selected through the move that moved it", () => {
    // `focus parent` survives a move in sway: what the keys moved is what the
    // next press moves, rather than the window inside it.
    const selected = { ...withFocusOn(NESTED, "c"), depth: 1 };

    const moved = movedBy(selected, Direction.Left);

    expect(focusedNodeOf(moved)).toMatchObject({ layout: Layout.SplitV });
  });

  it("moves a whole container past its neighbor", () => {
    const moved = movedBy(
      { ...withFocusOn(NESTED, "c"), depth: 1 },
      Direction.Left,
    );

    expect(windowsOf(moved)).toEqual(["b", "c", "a"]);
    expect(focusedIdOf(moved)).toBe("c");
  });

  it("moves within the container that runs the right way", () => {
    expect(
      windowsOf(movedBy(withFocusOn(NESTED, "b"), Direction.Down)),
    ).toEqual(["a", "c", "b"]);
  });

  it("has nothing to move on an empty workspace", () => {
    expect(movedBy(NOTHING_TILED, Direction.Right)).toBe(NOTHING_TILED);
  });

  it("leaves a lone window where it is", () => {
    const only = { depth: 0, root: LayoutNode.Window("a") };

    expect(movedBy(only, Direction.Right)).toBe(only);
  });
});
