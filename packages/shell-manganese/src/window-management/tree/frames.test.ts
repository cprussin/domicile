import { describe, expect, it } from "bun:test";

import { TITLE_BAR } from "../rect";
import { framesOf } from "./frames";
import { Layout, LayoutNode } from "./node";
import { NOTHING_TILED } from "./tiling";

const AREA = { height: 1000, width: 1000, x: 0, y: 0 };

/** A window beside a column of two, with the commands pointed into the column. */
const COLUMN_BESIDE_A_WINDOW = {
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

const frameFor = (
  tiled: ReturnType<typeof framesOf>,
  id: string,
): (typeof tiled.frames)[number] => {
  const frame = tiled.frames.find((found) => found.id === id);
  if (frame === undefined) {
    throw new Error(`no frame for ${id}`);
  } else {
    return frame;
  }
};

describe("framesOf", () => {
  it("places nothing for a workspace with nothing tiled", () => {
    expect(framesOf(NOTHING_TILED, AREA, 0)).toEqual({ frames: [], tabs: [] });
  });

  it("gives a lone window the whole area, bar included", () => {
    const tiled = framesOf({ depth: 0, root: LayoutNode.Window("a") }, AREA, 0);

    expect(frameFor(tiled, "a")).toEqual({
      bar: { height: TITLE_BAR, width: 1000, x: 0, y: 0 },
      behind: undefined,
      id: "a",
      openTab: undefined,
      selected: false,
      surface: {
        height: 1000 - TITLE_BAR,
        width: 1000,
        x: 0,
        y: TITLE_BAR,
      },
      tabbed: undefined,
    });
  });

  it("divides a row by each window's share, gap between them", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(
          Layout.SplitH,
          [LayoutNode.Window("a"), LayoutNode.Window("b")],
          0,
          [0.25, 0.75],
        ),
      },
      AREA,
      20,
    );

    // 20 of the 1000 goes to the gap, leaving 980 to share out.
    expect(frameFor(tiled, "a").bar).toMatchObject({ width: 245, x: 0 });
    expect(frameFor(tiled, "b").bar).toMatchObject({ width: 735, x: 265 });
  });

  it("divides a column the other way", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(Layout.SplitV, [
          LayoutNode.Window("a"),
          LayoutNode.Window("b"),
        ]),
      },
      AREA,
      0,
    );

    expect(frameFor(tiled, "a").bar).toMatchObject({ height: TITLE_BAR, y: 0 });
    expect(frameFor(tiled, "b").bar).toMatchObject({ y: 500 });
    expect(frameFor(tiled, "b").surface).toMatchObject({
      height: 500 - TITLE_BAR,
      y: 500 + TITLE_BAR,
    });
  });

  it("makes a tabbed container's title bars its tabs, a little apart", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(
          Layout.Tabbed,
          [LayoutNode.Window("a"), LayoutNode.Window("b")],
          1,
        ),
      },
      AREA,
      0,
    );

    expect(frameFor(tiled, "a").bar).toEqual({
      height: TITLE_BAR,
      width: 498,
      x: 0,
      y: 0,
    });
    expect(frameFor(tiled, "b").bar).toMatchObject({ width: 498, x: 502 });
  });

  it("shows only the tab a tabbed container has the focus in", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(
          Layout.Tabbed,
          [LayoutNode.Window("a"), LayoutNode.Window("b")],
          1,
        ),
      },
      AREA,
      0,
    );

    expect(frameFor(tiled, "a").surface).toBeUndefined();
    expect(frameFor(tiled, "b").surface).toEqual({
      height: 1000 - TITLE_BAR,
      width: 1000,
      x: 0,
      y: TITLE_BAR,
    });
  });

  // So that it is already on screen the moment its tab is: a window revealed
  // from nothing takes a frame or two to be drawn, and the desktop shows
  // through for as long as it does — behind a window opening over it, or one
  // closing off it.
  it("draws the tabs it is not showing under the one it is", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(
          Layout.Tabbed,
          [LayoutNode.Window("a"), LayoutNode.Window("b")],
          1,
        ),
      },
      AREA,
      0,
    );

    expect(frameFor(tiled, "a").behind).toEqual(frameFor(tiled, "b").surface);
    expect(frameFor(tiled, "b").behind).toBeUndefined();
  });

  it("stacks a stacking container's title bars above its contents", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(Layout.Stacking, [
          LayoutNode.Window("a"),
          LayoutNode.Window("b"),
        ]),
      },
      AREA,
      0,
    );

    expect(frameFor(tiled, "a").bar).toMatchObject({ width: 1000, y: 0 });
    expect(frameFor(tiled, "b").bar).toMatchObject({
      width: 1000,
      y: TITLE_BAR,
    });
    expect(frameFor(tiled, "a").surface).toMatchObject({ y: TITLE_BAR * 2 });
  });

  // What a tab closing plays out along: a tabbed container's tabs close up
  // across the gap one leaves, and a stack's close up down it.
  it("says which way the tabs a window's bar is one of run", () => {
    const tabbed = (layout: Layout.Stacking | Layout.Tabbed) =>
      framesOf(
        {
          depth: 1,
          root: LayoutNode.Container(layout, [
            LayoutNode.Window("a"),
            LayoutNode.Window("b"),
          ]),
        },
        AREA,
        0,
      ).frames.map((frame) => frame.tabbed);

    expect(tabbed(Layout.Tabbed)).toStrictEqual([Layout.Tabbed, Layout.Tabbed]);
    expect(tabbed(Layout.Stacking)).toStrictEqual([
      Layout.Stacking,
      Layout.Stacking,
    ]);
  });

  // Closing a container's only tab closes the container with it, which is a
  // window going rather than a tab.
  it("says nothing of a container's only tab, or a bar of a window's own", () => {
    const only = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
      },
      AREA,
      0,
    );

    expect(frameFor(only, "a").tabbed).toBeUndefined();
    expect(
      frameFor(framesOf(COLUMN_BESIDE_A_WINDOW, AREA, 0), "b").tabbed,
    ).toBeUndefined();
  });

  // What a tab that is not open draws a line under itself in the color of:
  // the open one's, so the strip's edge runs unbroken along the window's top.
  it("names the open tab to a tabbed container's other tabs, and to no other bar", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(
          Layout.Tabbed,
          [
            LayoutNode.Window("a"),
            LayoutNode.Container(
              Layout.SplitH,
              [LayoutNode.Window("b"), LayoutNode.Window("c")],
              1,
            ),
          ],
          1,
        ),
      },
      AREA,
      0,
    );

    expect(frameFor(tiled, "a").openTab).toBe("c");
    expect(tiled.tabs.map(({ openTab }) => openTab)).toStrictEqual([undefined]);
    expect(frameFor(tiled, "b").openTab).toBeUndefined();

    const behind = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(
          Layout.Tabbed,
          [
            LayoutNode.Window("a"),
            LayoutNode.Container(Layout.SplitH, [
              LayoutNode.Window("b"),
              LayoutNode.Window("c"),
            ]),
          ],
          0,
        ),
      },
      AREA,
      0,
    );
    expect(frameFor(behind, "a").openTab).toBeUndefined();
    expect(behind.tabs.map(({ openTab }) => openTab)).toStrictEqual(["a"]);

    // A stack's bars sit one on another, each over the next one's edge.
    const stacked = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(Layout.Stacking, [
          LayoutNode.Window("a"),
          LayoutNode.Window("b"),
        ]),
      },
      AREA,
      0,
    );
    expect(stacked.frames.map(({ openTab }) => openTab)).toStrictEqual([
      undefined,
      undefined,
    ]);
  });

  it("titles a tab that holds a container by the window in it", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(Layout.Tabbed, [
          LayoutNode.Container(Layout.SplitH, [
            LayoutNode.Window("a"),
            LayoutNode.Window("b"),
          ]),
          LayoutNode.Window("c"),
        ]),
      },
      AREA,
      0,
    );

    expect(tiled.tabs).toEqual([
      {
        active: true,
        id: "a",
        openTab: undefined,
        rect: { height: TITLE_BAR, width: 498, x: 0, y: 0 },
        selected: false,
      },
    ]);
    // And the windows inside it are laid out under the tabs, with title bars
    // of their own.
    expect(frameFor(tiled, "a").bar).toMatchObject({ y: TITLE_BAR });
  });

  it("leaves the windows behind an unfocused tab off the screen entirely", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(
          Layout.Tabbed,
          [
            LayoutNode.Container(Layout.SplitH, [
              LayoutNode.Window("a"),
              LayoutNode.Window("b"),
            ]),
            LayoutNode.Window("c"),
          ],
          1,
        ),
      },
      AREA,
      0,
    );

    expect(tiled.frames.map(({ id }) => id)).toEqual(["c"]);
    expect(tiled.tabs).toEqual([
      {
        active: false,
        id: "a",
        openTab: "c",
        rect: { height: TITLE_BAR, width: 498, x: 0, y: 0 },
        selected: false,
      },
    ]);
  });

  it("marks every window inside the container `focus parent` selected", () => {
    const tiled = framesOf({ ...COLUMN_BESIDE_A_WINDOW, depth: 1 }, AREA, 0);

    expect(tiled.frames.map(({ id, selected }) => [id, selected])).toEqual([
      ["a", false],
      ["b", true],
      ["c", true],
    ]);
  });

  it("marks nothing while the commands are pointed at a window", () => {
    expect(
      framesOf(COLUMN_BESIDE_A_WINDOW, AREA, 0).frames.some(
        ({ selected }) => selected,
      ),
    ).toBe(false);
  });

  it("marks the tabs and hidden windows of a selected container too", () => {
    const tiled = framesOf(
      {
        depth: 0,
        root: LayoutNode.Container(
          Layout.Tabbed,
          [
            LayoutNode.Window("a"),
            LayoutNode.Container(Layout.SplitV, [
              LayoutNode.Window("b"),
              LayoutNode.Window("c"),
            ]),
          ],
          1,
        ),
      },
      AREA,
      0,
    );

    expect(tiled.frames.every(({ selected }) => selected)).toBe(true);
    expect(tiled.tabs.map(({ selected }) => selected)).toEqual([true]);
  });
});
