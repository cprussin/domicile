import { describe, expect, it } from "bun:test";
import { inserted } from "./insert";
import { Layout, LayoutNode } from "./node";
import { removed } from "./remove";
import {
  focusedIdOf,
  NOTHING_TILED,
  shownOver,
  windowsOf,
  withFocusOn,
} from "./tiling";

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

  it("hands the focus to the window focused before it, as sway does", () => {
    const visited = withFocusOn(withFocusOn(ROW, "a"), "c");

    expect(focusedIdOf(removed(visited, "c"))).toBe("a");
  });

  it("hands the focus back to the window a new one opened beside", () => {
    const opened = inserted(withFocusOn(ROW, "a"), "d");

    expect(focusedIdOf(removed(opened, "d"))).toBe("a");
  });

  it("leaves the focus where it was when something else closed", () => {
    expect(focusedIdOf(removed(ROW, "a"))).toBe("b");
  });

  describe("in a tab stack", () => {
    const tabs = (layout: Layout) => ({
      depth: 1,
      root: LayoutNode.Container(
        layout,
        [
          LayoutNode.Window("a"),
          LayoutNode.Window("b"),
          LayoutNode.Window("c"),
        ],
        1,
      ),
    });

    it("hands the focus to the tab focused before it, as sway does", () => {
      const visited = (layout: Layout) =>
        withFocusOn(withFocusOn(tabs(layout), "c"), "a");

      expect(focusedIdOf(removed(visited(Layout.Tabbed), "a"))).toBe("c");
      expect(focusedIdOf(removed(visited(Layout.Stacking), "a"))).toBe("c");
    });

    it("shows the tab focused before a closed open tab", () => {
      // Focus is in another group, so only which tab shows changes.
      const beside = {
        depth: 1,
        root: LayoutNode.Container(
          Layout.SplitH,
          [
            LayoutNode.Container(Layout.Tabbed, [
              LayoutNode.Window("a", 2),
              LayoutNode.Window("b"),
              LayoutNode.Window("c", 1),
            ]),
            LayoutNode.Window("d", 3),
          ],
          1,
        ),
      };
      const { root } = removed(beside, "a");

      expect(root === undefined ? undefined : shownOver(root, "b")).toBe("c");
    });
  });

  it("keeps a container left holding one window", () => {
    // A group changes only on request, so closing a window keeps its layout.
    expect(removed(NESTED, "c").root).toEqual(
      LayoutNode.Container(
        Layout.SplitH,
        [
          LayoutNode.Window("a"),
          LayoutNode.Container(Layout.SplitV, [LayoutNode.Window("b")]),
        ],
        1,
      ),
    );
  });

  it("keeps a tab group left holding one tab", () => {
    const tabs = {
      depth: 1,
      root: LayoutNode.Container(Layout.Tabbed, [
        LayoutNode.Window("a"),
        LayoutNode.Window("b"),
      ]),
    };

    expect(removed(tabs, "b").root).toEqual(
      LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
    );
  });

  it("replaces a container left holding one group with that group", () => {
    expect(removed(NESTED, "a").root).toEqual(COLUMN);
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
    // The host sends closes for windows on other workspaces; ignore them.
    expect(removed(ROW, "z")).toBe(ROW);
  });

  it("empties a workspace whose lone split loses its only child", () => {
    // `splith` on a lone window leaves a one-child container, which goes with
    // the window.
    const split = {
      depth: 1,
      root: LayoutNode.Container(Layout.SplitV, [LayoutNode.Window("a")]),
    };

    expect(removed(split, "a")).toEqual(NOTHING_TILED);
  });
});
