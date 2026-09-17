import { describe, expect, it } from "bun:test";

import { Layout, LayoutNode } from "./node";
import { removed } from "./remove";
import { focusedIdOf, NOTHING_TILED, windowsOf, withFocusOn } from "./tiling";

const COLUMN = LayoutNode.Container(Layout.SplitV, [
  LayoutNode.Window("b"),
  LayoutNode.Window("c"),
]);

/** A window beside a column of two. */
const NESTED = {
  depth: 2,
  root: LayoutNode.Container(
    Layout.SplitH,
    [LayoutNode.Window("a"), COLUMN],
    1,
  ),
};

const ROW = {
  depth: 1,
  root: LayoutNode.Container(
    Layout.SplitH,
    [LayoutNode.Window("a"), LayoutNode.Window("b"), LayoutNode.Window("c")],
    1,
  ),
};

describe("removed", () => {
  it("empties a workspace whose only window went", () => {
    expect(removed({ depth: 0, root: LayoutNode.Window("a") }, "a")).toEqual(
      NOTHING_TILED,
    );
  });

  it("takes the window out of its container", () => {
    expect(windowsOf(removed(ROW, "b"))).toEqual(["a", "c"]);
  });

  it("hands the focus to the next window along", () => {
    expect(focusedIdOf(removed(ROW, "b"))).toBe("c");
  });

  it("falls back to the one before where there is no next", () => {
    expect(focusedIdOf(removed(withFocusOn(ROW, "c"), "c"))).toBe("b");
  });

  it("leaves the focus where it was when something else closed", () => {
    expect(focusedIdOf(removed(ROW, "a"))).toBe("b");
  });

  it("flattens a container left holding one window", () => {
    // Which is i3's own rule: a container of one is not a layout, it is a
    // window with a box drawn round it.
    expect(removed(NESTED, "c").root).toEqual(
      LayoutNode.Container(
        Layout.SplitH,
        [LayoutNode.Window("a"), LayoutNode.Window("b")],
        1,
      ),
    );
  });

  it("keeps what is left of a resized container in proportion", () => {
    const resized = {
      depth: 1,
      root: LayoutNode.Container(
        Layout.SplitH,
        [
          LayoutNode.Window("a"),
          LayoutNode.Window("b"),
          LayoutNode.Window("c"),
        ],
        0,
        [0.5, 0.25, 0.25],
      ),
    };

    expect(removed(resized, "c").root).toMatchObject({
      fractions: [2 / 3, 1 / 3],
    });
  });

  it("leaves a tree that never held the window alone", () => {
    // The host drains events for windows on other workspaces, and a close
    // that names one of those is not this tree's business.
    expect(removed(ROW, "z")).toBe(ROW);
  });

  it("empties a workspace whose lone split loses its only child", () => {
    // A container of one is what `splith` on a single window leaves behind,
    // and the window closing takes the container with it.
    const split = {
      depth: 1,
      root: LayoutNode.Container(Layout.SplitV, [LayoutNode.Window("a")]),
    };

    expect(removed(split, "a")).toEqual(NOTHING_TILED);
  });
});
