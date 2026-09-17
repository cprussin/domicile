import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { Layout, LayoutNode } from "./node";
import { RESIZE_STEP, resized } from "./resize";
import { NOTHING_TILED, withFocusOn } from "./tiling";

const ROW = {
  depth: 1,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Window("a"),
    LayoutNode.Window("b"),
  ]),
};

describe("resized", () => {
  it("takes what it grows by from the window beside it", () => {
    expect(resized(withFocusOn(ROW, "a"), Direction.Right).root).toMatchObject({
      fractions: [0.5 + RESIZE_STEP, 0.5 - RESIZE_STEP],
    });
  });

  it("shrinks the other way about", () => {
    expect(resized(withFocusOn(ROW, "a"), Direction.Left).root).toMatchObject({
      fractions: [0.5 - RESIZE_STEP, 0.5 + RESIZE_STEP],
    });
  });

  it("gives the window before it what it has no window after it to take", () => {
    expect(resized(withFocusOn(ROW, "b"), Direction.Right).root).toMatchObject({
      fractions: [0.5 - RESIZE_STEP, 0.5 + RESIZE_STEP],
    });
  });

  it("leaves the tree alone where nothing runs that way", () => {
    const tiling = withFocusOn(ROW, "a");

    expect(resized(tiling, Direction.Down)).toBe(tiling);
  });

  it("stops rather than squeezing a window out of existence", () => {
    const lopsided = {
      depth: 1,
      root: LayoutNode.Container(
        Layout.SplitH,
        [LayoutNode.Window("a"), LayoutNode.Window("b")],
        0,
        [0.96, 0.04],
      ),
    };

    expect(resized(lopsided, Direction.Right)).toBe(lopsided);
  });

  it("has nothing to resize on an empty workspace", () => {
    expect(resized(NOTHING_TILED, Direction.Right)).toBe(NOTHING_TILED);
  });
});
