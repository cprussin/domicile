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

/** A window beside a column of two, the column focused at its bottom. */
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

/** A column of two beside a window, which the window moves into. */
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

/** An uneven row of three; the middle is a column of two. */
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

/** A window beside a tabbed container of two, showing its second tab. */
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
    // As in i3, moving across the container's axis splits the workspace the
    // other way.
    const moved = movedBy(withFocusOn(ROW, "a"), Direction.Down);

    expect(moved.root).toMatchObject({ layout: Layout.SplitV });
    expect(windowsOf(moved)).toEqual(["b", "c", "a"]);
  });

  describe("off the end of a tabbed workspace", () => {
    const tabs = {
      depth: 1,
      root: LayoutNode.Container(Layout.Tabbed, [
        LayoutNode.Window("a"),
        LayoutNode.Window("b"),
        LayoutNode.Window("c"),
      ]),
    };

    it("splits the last tab out to the right", () => {
      const moved = movedBy(withFocusOn(tabs, "c"), Direction.Right);

      expect(moved.root).toMatchObject({
        children: [{ layout: Layout.Tabbed }, { id: "c" }],
        layout: Layout.SplitH,
      });
      expect(focusedIdOf(moved)).toBe("c");
    });

    it("splits the first tab out to the left", () => {
      const moved = movedBy(withFocusOn(tabs, "a"), Direction.Left);

      expect(moved.root).toMatchObject({
        children: [{ id: "a" }, { layout: Layout.Tabbed }],
        layout: Layout.SplitH,
      });
    });
  });

  it("moves a window out of the container it is in", () => {
    const moved = movedBy(withFocusOn(NESTED, "b"), Direction.Left);

    expect(windowsOf(moved)).toEqual(["a", "b", "c"]);
    expect(moved.root).toMatchObject({ children: [{}, {}, {}] });
  });

  it("moves a window into the container beside it", () => {
    // As in sway, a window moved at a container joins it instead of swapping.
    const moved = movedBy(withFocusOn(NESTED, "a"), Direction.Right);

    // Beside the container's last-focused child, on the side it came from.
    expect(windowsOf(moved)).toEqual(["b", "a", "c"]);
    expect(focusedIdOf(moved)).toBe("a");
    // The container left with one child collapses into it.
    expect(moved.root).toMatchObject({ layout: Layout.SplitV });
  });

  it("enters a container running its way at the edge it came from", () => {
    // A tabbed container runs horizontally, so entering from the left makes
    // the window the first tab.
    const moved = movedBy(withFocusOn(TABBED, "a"), Direction.Right);

    expect(windowsOf(moved)).toEqual(["a", "b", "c"]);
    expect(moved.root).toMatchObject({ layout: Layout.Tabbed });
  });

  it("enters a container it is moved back into from the other side", () => {
    // Entering a column across its axis lands beside its last-focused window,
    // on the side the window came from.
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
    // sway recurses into the focused child
    // (`container_move_to_container_from_direction`), so the window joins
    // the nested row.
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

    // At the row's near end.
    expect(windowsOf(moved)).toEqual(["a", "b", "c", "d"]);
    expect(moved.root).toMatchObject({
      children: [{ children: [{}, {}, {}] }, {}],
      layout: Layout.SplitV,
    });
  });

  it("gives the row the window left its share back", () => {
    // The row collapses as after a close; the rest keep their relative sizes.
    const moved = movedBy(withFocusOn(RESIZED_ROW, "a"), Direction.Right);

    expect(windowsOf(moved)).toEqual(["a", "c", "d", "b"]);
    // The column had 0.6 and `b` 0.2: three to one.
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

    // The whole column lands between the other column's two windows.
    expect(windowsOf(moved)).toEqual(["a", "b", "c", "d"]);
    expect(moved.root).toMatchObject({
      children: [{ children: [{}, {}] }, {}, {}],
      layout: Layout.SplitV,
    });
  });

  it("keeps a container selected through the move that moved it", () => {
    // In sway, `focus parent` survives a move, so the next press moves the
    // same container.
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
