import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { movedBy } from "./move";
import { Layout, LayoutNode } from "./node";
import { focusedIdOf, NOTHING_TILED, windowsOf, withFocusOn } from "./tiling";

const ROW = {
  depth: 1,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Window("a"),
    LayoutNode.Window("b"),
    LayoutNode.Window("c"),
  ]),
};

/** A window beside a column of two. */
const NESTED = {
  depth: 2,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Window("a"),
    LayoutNode.Container(Layout.SplitV, [
      LayoutNode.Window("b"),
      LayoutNode.Window("c"),
    ]),
  ]),
};

describe("movedBy", () => {
  it("moves a window past its neighbour", () => {
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

  it("moves a whole container past its neighbour", () => {
    const moved = movedBy(withFocusOn(NESTED, "a"), Direction.Right);

    expect(windowsOf(moved)).toEqual(["b", "c", "a"]);
    expect(focusedIdOf(moved)).toBe("a");
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
