import { describe, expect, it } from "bun:test";

import { inserted } from "./insert";
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

/** A window beside a column of two, with the column's first being worked in. */
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
  it("makes the first window the whole tree", () => {
    const tiling = inserted(NOTHING_TILED, "a");

    expect(tiling.root).toEqual(LayoutNode.Window("a"));
    expect(focusedIdOf(tiling)).toBe("a");
  });

  it("splits the workspace horizontally for the second one", () => {
    // sway's `default_orientation` on a screen wider than it is tall, which is
    // the desktop this shell is for.
    expect(tiled("a", "b").root).toMatchObject({ layout: Layout.SplitH });
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
    // The focus is the outer container, so the window lands beside the column
    // rather than inside it.
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
