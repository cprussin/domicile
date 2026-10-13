import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { Layout, LayoutNode } from "./node";
import { stretched } from "./stretch";

const AREA = { height: 800, width: 1000, x: 0, y: 0 };

const ROW = {
  depth: 1,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Window("a"),
    LayoutNode.Window("b"),
  ]),
};

/** A window beside a column whose foot is a row of two. */
const NESTED = {
  depth: 1,
  root: LayoutNode.Container(Layout.SplitH, [
    LayoutNode.Window("a"),
    LayoutNode.Container(Layout.SplitV, [
      LayoutNode.Window("b"),
      LayoutNode.Container(Layout.SplitH, [
        LayoutNode.Window("c"),
        LayoutNode.Window("d"),
      ]),
    ]),
  ]),
};

describe("stretched", () => {
  it("moves the edge dragged by the pixels it was dragged", () => {
    expect(
      stretched(ROW, "a", Direction.Right, 100, AREA, 0).root,
    ).toMatchObject({ fractions: [0.6, 0.4] });
  });

  it("moves the edge before a window the same way", () => {
    expect(
      stretched(ROW, "b", Direction.Left, -100, AREA, 0).root,
    ).toMatchObject({ fractions: [0.4, 0.6] });
  });

  it("measures a share of what is left between the gaps", () => {
    const wide = { ...AREA, width: 1020 };

    expect(
      stretched(ROW, "a", Direction.Right, 100, wide, 20).root,
    ).toMatchObject({ fractions: [0.6, 0.4] });
  });

  it("climbs to the container that runs the way the edge moves", () => {
    expect(
      stretched(NESTED, "b", Direction.Left, -100, AREA, 0).root,
    ).toMatchObject({ fractions: [0.4, 0.6] });
  });

  it("measures a share of the container it moves an edge in", () => {
    // The `c`/`d` row is 500px wide, so 50px is a tenth of it.
    const inner = stretched(NESTED, "c", Direction.Right, 50, AREA, 0).root;

    expect(inner).toMatchObject({
      children: [{}, { children: [{}, { fractions: [0.6, 0.4] }] }],
    });
  });

  it("leaves the tree alone at the edge of the workspace", () => {
    expect(stretched(ROW, "a", Direction.Left, -100, AREA, 0)).toBe(ROW);
  });

  it("stops at the smallest share rather than squeezing a window out", () => {
    expect(
      stretched(ROW, "a", Direction.Right, 900, AREA, 0).root,
    ).toMatchObject({
      fractions: [expect.closeTo(0.95), expect.closeTo(0.05)],
    });
  });
});
