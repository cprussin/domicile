import { describe, expect, it } from "bun:test";

import { Layout, LayoutNode } from "./node";
import { ancestorsOf, nodeAt, pathTo, replacedAt } from "./path";

const TREE = LayoutNode.Container(Layout.SplitH, [
  LayoutNode.Window("a"),
  LayoutNode.Container(Layout.SplitV, [
    LayoutNode.Window("b"),
    LayoutNode.Window("c"),
  ]),
]);

describe("pathTo", () => {
  it("finds a window by the children walked to reach it", () => {
    expect(pathTo(TREE, "c")).toEqual([1, 1]);
  });

  it("finds a window that is the whole tree at no depth at all", () => {
    expect(pathTo(LayoutNode.Window("a"), "a")).toEqual([]);
  });

  it("answers for a window that is not in the tree", () => {
    expect(pathTo(TREE, "z")).toBeUndefined();
  });
});

describe("nodeAt", () => {
  it("reads back what the path led to", () => {
    expect(nodeAt(TREE, [1, 0])).toEqual(LayoutNode.Window("b"));
  });

  it("throws for a path that leaves the tree", () => {
    // A path is built from the tree it is walked in, so one that does not fit
    // is a wiring fault rather than a missing window.
    expect(() => nodeAt(TREE, [0, 1])).toThrow();
  });
});

describe("ancestorsOf", () => {
  it("lists the containers on the way, the innermost first", () => {
    expect(
      ancestorsOf(TREE, [1, 1]).map(({ index, path }) => [path, index]),
    ).toEqual([
      [[1], 1],
      [[], 1],
    ]);
  });

  it("lists nothing for the root itself", () => {
    expect(ancestorsOf(TREE, [])).toEqual([]);
  });
});

describe("replacedAt", () => {
  it("rebuilds the branch to the node it replaces", () => {
    const replaced = replacedAt(TREE, [1, 1], () => LayoutNode.Window("z"));

    expect(nodeAt(replaced, [1, 1])).toEqual(LayoutNode.Window("z"));
  });

  it("leaves every other branch the object it already was", () => {
    // Which is what keeps a window the focus moved past from re-rendering:
    // React bails out on an unchanged prop, and a tree rebuilt whole has none.
    const replaced = replacedAt(TREE, [1, 1], () => LayoutNode.Window("z"));

    expect(nodeAt(replaced, [0])).toBe(nodeAt(TREE, [0]));
  });

  it("keeps a container's focus and shares as it rebuilds", () => {
    const resized = LayoutNode.Container(
      Layout.SplitH,
      [LayoutNode.Window("a"), LayoutNode.Window("b")],
      1,
      [0.25, 0.75],
    );

    const replaced = replacedAt(resized, [0], () => LayoutNode.Window("z"));

    expect(replaced).toMatchObject({ focused: 1, fractions: [0.25, 0.75] });
  });

  it("replaces the whole tree for the empty path", () => {
    expect(replacedAt(TREE, [], () => LayoutNode.Window("z"))).toEqual(
      LayoutNode.Window("z"),
    );
  });
});
