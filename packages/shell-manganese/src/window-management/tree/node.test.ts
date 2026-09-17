import { describe, expect, it } from "bun:test";

import { Axis } from "../direction";
import { axisOf, Layout, LayoutNode, windowsIn } from "./node";

describe("LayoutNode.Container", () => {
  it("divides itself evenly between the children it is given", () => {
    const container = LayoutNode.Container(Layout.SplitH, [
      LayoutNode.Window("a"),
      LayoutNode.Window("b"),
      LayoutNode.Window("c"),
    ]);

    expect(container.fractions).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("focuses its first child until something says otherwise", () => {
    const container = LayoutNode.Container(Layout.SplitV, [
      LayoutNode.Window("a"),
      LayoutNode.Window("b"),
    ]);

    expect(container.focused).toBe(0);
  });

  it("refuses to hold no children at all", () => {
    // An empty container is a hole in the layout: it takes up space, shows
    // nothing, and cannot be focused out of. A workspace with nothing on it
    // has no root instead.
    expect(() => LayoutNode.Container(Layout.SplitH, [])).toThrow();
  });
});

describe("windowsIn", () => {
  it("lists a whole subtree in the order it is laid out", () => {
    const tree = LayoutNode.Container(Layout.SplitH, [
      LayoutNode.Window("a"),
      LayoutNode.Container(Layout.SplitV, [
        LayoutNode.Window("b"),
        LayoutNode.Window("c"),
      ]),
      LayoutNode.Window("d"),
    ]);

    expect(windowsIn(tree)).toEqual(["a", "b", "c", "d"]);
  });

  it("lists a lone window as itself", () => {
    expect(windowsIn(LayoutNode.Window("a"))).toEqual(["a"]);
  });
});

describe("axisOf", () => {
  it("reads a tabbed container as the horizontal thing it looks like", () => {
    // Which is what decides the keys: `focus right` in a tabbed container is
    // the next tab, and `focus down` leaves it.
    expect(axisOf(Layout.Tabbed)).toBe(Axis.Horizontal);
    expect(axisOf(Layout.Stacking)).toBe(Axis.Vertical);
  });
});
