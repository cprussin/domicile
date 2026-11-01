import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { movedBy, pushedOn } from "./move";
import { Layout, LayoutNode } from "./node";
import { removed } from "./remove";
import {
  focusedIdOf,
  focusedNodeOf,
  focusedParent,
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

  it("keeps each window's focus history as it moves", () => {
    const visited = withFocusOn(withFocusOn(ROW, "c"), "b");

    expect(focusedIdOf(removed(movedBy(visited, Direction.Left), "b"))).toBe(
      "c",
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

  it("hands the focus back across the group a window moved out of", () => {
    // sway's focus stack is per window, so b's old column does not inherit
    // b's place in it.
    const row = {
      depth: 1,
      root: LayoutNode.Container(Layout.SplitH, [
        LayoutNode.Window("a"),
        LayoutNode.Window("z"),
        LayoutNode.Container(Layout.SplitV, [
          LayoutNode.Window("b"),
          LayoutNode.Window("e"),
        ]),
      ]),
    };
    const visited = withFocusOn(withFocusOn(row, "z"), "b");

    expect(focusedIdOf(removed(movedBy(visited, Direction.Left), "b"))).toBe(
      "z",
    );
  });

  it("keeps the group a window moves out into, even with it alone", () => {
    const nested = {
      depth: 2,
      root: LayoutNode.Container(Layout.SplitH, [
        LayoutNode.Container(Layout.SplitV, [LayoutNode.Window("a")]),
      ]),
    };

    expect(movedBy(nested, Direction.Right).root).toEqual(
      LayoutNode.Container(Layout.SplitH, [LayoutNode.Window("a", 1)]),
    );
  });

  it("moves a window alone in its tab group into the group beside it", () => {
    // The group of one is the window: it does not leave it for the same spot.
    const groups = withFocusOn(
      {
        depth: 0,
        root: LayoutNode.Container(Layout.SplitH, [
          LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
          LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("b")]),
        ]),
      },
      "b",
    );

    const moved = movedBy(groups, Direction.Left);

    expect(moved.root).toMatchObject({
      children: [{ id: "a" }, { id: "b" }],
      layout: Layout.Tabbed,
    });
    expect(focusedNodeOf(moved)).toMatchObject({ id: "b" });
  });

  it("swaps a selected tab group with the tab group beside it", () => {
    // Joining groups is `layout tabbed` on their split; a move reorders them.
    const groups = withFocusOn(
      {
        depth: 0,
        root: LayoutNode.Container(Layout.SplitH, [
          LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
          LayoutNode.Container(Layout.Tabbed, [
            LayoutNode.Window("b"),
            LayoutNode.Window("c"),
          ]),
        ]),
      },
      "b",
    );

    const moved = movedBy(focusedParent(groups), Direction.Left);

    expect(moved.root).toMatchObject({
      children: [
        { children: [{ id: "b" }, { id: "c" }] },
        { children: [{ id: "a" }] },
      ],
      layout: Layout.SplitH,
    });
    expect(focusedNodeOf(moved)).toMatchObject({ layout: Layout.Tabbed });
  });

  it("puts a selected tab group beside the groups of a split it enters", () => {
    const row = withFocusOn(
      {
        depth: 0,
        root: LayoutNode.Container(Layout.SplitH, [
          LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
          LayoutNode.Container(Layout.SplitV, [
            LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("b")]),
            LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("c")]),
          ]),
        ]),
      },
      "a",
    );

    const moved = movedBy(focusedParent(row), Direction.Right);

    expect(moved.root).toMatchObject({
      children: [
        { children: [{ id: "a" }] },
        { children: [{ id: "b" }] },
        { children: [{ id: "c" }] },
      ],
      layout: Layout.SplitV,
    });
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

  describe("between two resized tab groups", () => {
    /** Two tab groups at 70% and 30%, the left one showing its last tab. */
    const groups = {
      depth: 2,
      root: LayoutNode.Container(
        Layout.SplitH,
        [
          LayoutNode.Container(
            Layout.Tabbed,
            [LayoutNode.Window("a"), LayoutNode.Window("b")],
            1,
          ),
          LayoutNode.Container(Layout.Tabbed, [
            LayoutNode.Window("c"),
            LayoutNode.Window("d"),
          ]),
        ],
        0,
        [0.7, 0.3],
      ),
    };

    it("keeps the groups' relative sizes while the window sits between them", () => {
      const between = movedBy(groups, Direction.Right);

      expect(windowsOf(between)).toEqual(["a", "b", "c", "d"]);
      // The groups keep seven to three; the window gets a third.
      expect(between.root).toMatchObject({
        fractions: [
          expect.closeTo(0.7 * (2 / 3)),
          expect.closeTo(1 / 3),
          expect.closeTo(0.3 * (2 / 3)),
        ],
      });
    });

    it("gives the groups their sizes back once the window joins the other", () => {
      const joined = movedBy(movedBy(groups, Direction.Right), Direction.Right);

      expect(windowsOf(joined)).toEqual(["a", "b", "c", "d"]);
      expect(joined.root).toMatchObject({
        fractions: [expect.closeTo(0.7), expect.closeTo(0.3)],
      });
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

describe("pushedOn", () => {
  it("puts a tab group arriving at a tab group beside it", () => {
    const arriving = LayoutNode.Container(Layout.Tabbed, [
      LayoutNode.Window("a"),
      LayoutNode.Window("b"),
    ]);
    const there = withFocusOn(
      {
        depth: 0,
        root: LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("c")]),
      },
      "c",
    );

    expect(pushedOn(there, arriving, Direction.Right).root).toMatchObject({
      children: [{ children: [{}, {}] }, { children: [{ id: "c" }] }],
      layout: Layout.SplitH,
    });
  });
});
