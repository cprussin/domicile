import { describe, expect, it } from "bun:test";

import { Layout, LayoutNode } from "./node";
import {
  focusedChild,
  focusedIdOf,
  focusedNodeOf,
  focusedParent,
  NOTHING_TILED,
  shownOver,
  windowsOf,
  withFocusOn,
} from "./tiling";

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

describe("windowsOf", () => {
  it("lists nothing for a workspace with nothing tiled on it", () => {
    expect(windowsOf(NOTHING_TILED)).toEqual([]);
  });

  it("lists every window in the tree", () => {
    expect(windowsOf(NESTED)).toEqual(["a", "b", "c"]);
  });
});

describe("focusedIdOf", () => {
  it("follows each container's own focus down to a window", () => {
    expect(focusedIdOf(NESTED)).toBe("b");
  });

  it("stays the window inside a focused container", () => {
    // `focus parent` selects a container for commands; keyboard focus stays
    // on the window.
    expect(focusedIdOf(focusedParent(NESTED))).toBe("b");
  });

  it("has nothing to answer with on an empty workspace", () => {
    expect(focusedIdOf(NOTHING_TILED)).toBeUndefined();
  });
});

describe("shownOver", () => {
  it("answers with the tab the outermost container hiding the window shows", () => {
    // `c` is behind `b`, and both are behind `a`, so only `a` is visible.
    const root = LayoutNode.Container(
      Layout.Tabbed,
      [
        LayoutNode.Window("a"),
        LayoutNode.Container(Layout.Tabbed, [
          LayoutNode.Window("b"),
          LayoutNode.Window("c"),
        ]),
      ],
      0,
    );

    expect(shownOver(root, "c")).toBe("a");
  });
});

describe("withFocusOn", () => {
  it("points every container on the way at the window named", () => {
    const focused = withFocusOn(NESTED, "c");

    expect(focusedIdOf(focused)).toBe("c");
  });

  it("leaves the focus on the window rather than on a container", () => {
    const focused = withFocusOn(focusedParent(NESTED), "c");

    expect(focusedNodeOf(focused)).toEqual(LayoutNode.Window("c", 1));
  });

  it("stamps the window it focuses as focused last", () => {
    const visited = withFocusOn(withFocusOn(NESTED, "a"), "b");

    expect(focusedNodeOf(visited)).toEqual(LayoutNode.Window("b", 2));
  });

  it("keeps the stamp of a window focused again", () => {
    const visited = withFocusOn(NESTED, "a");

    expect(focusedNodeOf(withFocusOn(visited, "a"))).toEqual(
      LayoutNode.Window("a", 1),
    );
  });

  it("throws for a window the tree does not hold", () => {
    expect(() => withFocusOn(NESTED, "z")).toThrow();
  });
});

describe("focusedParent", () => {
  it("selects the container the focused window is in", () => {
    expect(focusedNodeOf(focusedParent(NESTED))).toMatchObject({
      layout: Layout.SplitV,
    });
  });

  it("stops at the root rather than climbing out of the tree", () => {
    const root = focusedParent(focusedParent(focusedParent(NESTED)));

    expect(focusedNodeOf(root)).toMatchObject({ layout: Layout.SplitH });
  });
});

describe("focusedChild", () => {
  it("goes back down the way focusedParent came up", () => {
    expect(focusedNodeOf(focusedChild(focusedParent(NESTED)))).toEqual(
      LayoutNode.Window("b"),
    );
  });

  it("stops at the window, which has no child to select", () => {
    expect(focusedNodeOf(focusedChild(NESTED))).toEqual(LayoutNode.Window("b"));
  });
});
