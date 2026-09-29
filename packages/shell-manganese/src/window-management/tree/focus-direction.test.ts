import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { enteredFrom, focusMoved, leavesBy } from "./focus-direction";
import { Layout, LayoutNode } from "./node";
import { focusedIdOf, NOTHING_TILED, withFocusOn } from "./tiling";

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

const TABS = {
  depth: 1,
  root: LayoutNode.Container(Layout.Tabbed, [
    LayoutNode.Window("a"),
    LayoutNode.Window("b"),
  ]),
};

const moved = (
  tiling: typeof ROW,
  id: string,
  direction: Direction,
): string | undefined =>
  focusedIdOf(focusMoved(withFocusOn(tiling, id), direction));

describe("focusMoved", () => {
  it("moves along the container the focus is in", () => {
    expect(moved(ROW, "b", Direction.Right)).toBe("c");
    expect(moved(ROW, "b", Direction.Left)).toBe("a");
  });

  it("wraps at the end of the container, the way the config asks", () => {
    // `focus.wrapping = "yes"`.
    expect(moved(ROW, "c", Direction.Right)).toBe("a");
    expect(moved(ROW, "a", Direction.Left)).toBe("c");
  });

  it("leaves the focus where it is when nothing runs that way", () => {
    expect(moved(ROW, "b", Direction.Down)).toBe("b");
  });

  it("crosses into a container by the window it last had the focus in", () => {
    expect(moved(NESTED, "a", Direction.Right)).toBe("b");
    expect(
      focusedIdOf(focusMoved(withFocusOn(NESTED, "c"), Direction.Left)),
    ).toBe("a");
  });

  it("climbs out of a container that does not run that way", () => {
    expect(moved(NESTED, "b", Direction.Left)).toBe("a");
  });

  it("moves within the container that does", () => {
    expect(moved(NESTED, "b", Direction.Down)).toBe("c");
  });

  it("walks a tabbed container's tabs left and right", () => {
    expect(moved(TABS, "a", Direction.Right)).toBe("b");
  });

  it("has nothing to move on an empty workspace", () => {
    expect(focusMoved(NOTHING_TILED, Direction.Right)).toBe(NOTHING_TILED);
  });
});

describe("leavesBy", () => {
  it("is where nothing lies that way before the focus would wrap", () => {
    // sway goes to the screen that way before it wraps round.
    expect(leavesBy(withFocusOn(ROW, "c"), Direction.Right)).toBe(true);
    expect(leavesBy(withFocusOn(ROW, "b"), Direction.Down)).toBe(true);
    expect(leavesBy(withFocusOn(NESTED, "b"), Direction.Right)).toBe(true);
  });

  it("is not where a window lies that way", () => {
    expect(leavesBy(withFocusOn(ROW, "b"), Direction.Right)).toBe(false);
    expect(leavesBy(withFocusOn(NESTED, "c"), Direction.Left)).toBe(false);
  });

  it("is every way out of an empty workspace", () => {
    expect(leavesBy(NOTHING_TILED, Direction.Up)).toBe(true);
  });
});

describe("enteredFrom", () => {
  it("lands on the near edge of a tiling that runs the way the focus came", () => {
    // Coming in moving right is coming in by the left edge.
    expect(enteredFrom(withFocusOn(ROW, "b"), Direction.Right)).toBe("a");
    expect(enteredFrom(withFocusOn(ROW, "b"), Direction.Left)).toBe("c");
  });

  it("lands in an edge container by the window it last had the focus in", () => {
    expect(enteredFrom(withFocusOn(NESTED, "c"), Direction.Left)).toBe("c");
  });

  it("lands on the tab showing, whichever way the focus came", () => {
    // sway's edge rule is for splits only; a tabbed or stacked tiling shows
    // one window, and coming in does not change which.
    expect(enteredFrom(withFocusOn(TABS, "b"), Direction.Right)).toBe("b");
  });

  it("lands on the tiling's own focus where it runs the other way", () => {
    expect(enteredFrom(withFocusOn(ROW, "b"), Direction.Down)).toBe("b");
  });

  it("lands on a lone window", () => {
    const lone = { depth: 0, root: LayoutNode.Window("a") };
    expect(enteredFrom(lone, Direction.Up)).toBe("a");
  });

  it("lands nowhere on an empty workspace", () => {
    expect(enteredFrom(NOTHING_TILED, Direction.Right)).toBeUndefined();
  });
});
