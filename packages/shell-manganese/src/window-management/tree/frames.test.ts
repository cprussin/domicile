import { describe, expect, it } from "bun:test";

import { SURFACE_TUCK, TITLE_BAR } from "../rect";
import { framesOf } from "./frames";
import { Layout, LayoutNode } from "./node";
import { NOTHING_TILED } from "./tiling";

const AREA = { height: 1000, width: 1000, x: 0, y: 0 };

/** A window beside a column of two, with focus in the column. */
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
      selected: false,
      soleTab: false,
      strip: undefined,
      surface: {
        height: 1000 - TITLE_BAR + SURFACE_TUCK,
        width: 1000,
        x: 0,
        y: TITLE_BAR - SURFACE_TUCK,
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

  it("leaves room at the end of a split of one, where the next window opens", () => {
    const lone = (layout: Layout) =>
      framesOf(
        {
          depth: 1,
          root: LayoutNode.Container(layout, [LayoutNode.Window("a")]),
        },
        AREA,
        20,
      );

    expect(frameFor(lone(Layout.SplitH), "a").bar).toEqual({
      height: TITLE_BAR,
      width: 936,
      x: 0,
      y: 0,
    });
    expect(frameFor(lone(Layout.SplitV), "a").surface).toEqual({
      height: 936 - TITLE_BAR + SURFACE_TUCK,
      width: 1000,
      x: 0,
      y: TITLE_BAR - SURFACE_TUCK,
    });
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
      height: 500 - TITLE_BAR + SURFACE_TUCK,
      y: 500 + TITLE_BAR - SURFACE_TUCK,
    });
  });

  it("makes a tabbed container's title bars its tabs, side by side", () => {
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

    // The tab strip is one row; the bars draw the space between tabs.
    expect(frameFor(tiled, "a").bar).toEqual({
      height: TITLE_BAR,
      width: 240,
      x: 0,
      y: 0,
    });
    expect(frameFor(tiled, "b").bar).toMatchObject({ width: 240, x: 240 });
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
      height: 1000 - TITLE_BAR + SURFACE_TUCK,
      width: 1000,
      x: 0,
      y: TITLE_BAR - SURFACE_TUCK,
    });
  });

  // Hidden tabs stay drawn, so a switch shows them without a blank frame.
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
    expect(frameFor(tiled, "a").surface).toMatchObject({
      y: TITLE_BAR * 2 - SURFACE_TUCK,
    });
  });

  // Sets the direction a tab-close animation runs: across for tabbed, down for
  // stacking.
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

  it("marks a container's only tab as a tab, and a window's own bar as none", () => {
    const only = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(Layout.Tabbed, [LayoutNode.Window("a")]),
      },
      AREA,
      0,
    );

    expect(frameFor(only, "a").tabbed).toBe(Layout.Tabbed);
    // It closes with its group, as a window does, not along the strip.
    expect(frameFor(only, "a").soleTab).toBe(true);
    expect(
      frameFor(framesOf(COLUMN_BESIDE_A_WINDOW, AREA, 0), "b").tabbed,
    ).toBeUndefined();
  });

  describe("the tab strip", () => {
    const strip = (layout: Layout, count: number) =>
      framesOf(
        {
          depth: 1,
          root: LayoutNode.Container(
            layout,
            Array.from({ length: count }, (_, at) =>
              LayoutNode.Window(at.toString()),
            ),
          ),
        },
        AREA,
        0,
      ).frames.map(({ bar, strip }) => ({ strip, width: bar.width, x: bar.x }));

    it("caps each tab's width, leaving the rest of the strip after the last", () => {
      // The strip always shows past the tabs, so even one tab reads as a tab.
      expect(strip(Layout.Tabbed, 1)).toEqual([
        {
          strip: {
            at: 0,
            divided: false,
            first: true,
            open: true,
            rest: 760,
            tabs: 1,
          },
          width: 240,
          x: 0,
        },
      ]);
      expect(strip(Layout.Tabbed, 2)).toEqual([
        {
          strip: {
            at: 0,
            divided: false,
            first: true,
            open: true,
            rest: undefined,
            tabs: 2,
          },
          width: 240,
          x: 0,
        },
        {
          strip: {
            at: 1,
            divided: false,
            first: false,
            open: false,
            rest: 520,
            tabs: 2,
          },
          width: 240,
          x: 240,
        },
      ]);
    });

    it("shares out a crowded strip, keeping room for its end", () => {
      const crowded = strip(Layout.Tabbed, 8);

      expect(crowded.map(({ width }) => width)).toEqual(
        Array.from({ length: 8 }, () => 122),
      );
      expect(crowded.at(-1)?.strip).toEqual({
        at: 7,
        divided: true,
        first: false,
        open: false,
        rest: 24,
        tabs: 8,
      });
    });

    it("runs a stack's bars full width, the first at its top", () => {
      expect(strip(Layout.Stacking, 2)).toEqual([
        {
          strip: {
            at: 0,
            divided: false,
            first: true,
            open: true,
            rest: undefined,
            tabs: 2,
          },
          width: 1000,
          x: 0,
        },
        {
          strip: {
            at: 1,
            divided: false,
            first: false,
            open: false,
            rest: undefined,
            tabs: 2,
          },
          width: 1000,
          x: 0,
        },
      ]);
    });

    it("divides two hidden tabs, and no tab from the open one", () => {
      const divided = framesOf(
        {
          depth: 1,
          root: LayoutNode.Container(
            Layout.Tabbed,
            ["a", "b", "c", "d"].map((id) => LayoutNode.Window(id)),
            1,
          ),
        },
        AREA,
        0,
      ).frames.map(({ strip }) => strip?.divided);

      // `b` is open: only `d` starts beside a hidden tab.
      expect(divided).toEqual([false, false, false, true]);
    });

    it("places a window's own bar in no strip", () => {
      expect(
        frameFor(framesOf(COLUMN_BESIDE_A_WINDOW, AREA, 0), "b").strip,
      ).toBeUndefined();
    });
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
        group: Layout.SplitH,
        id: "a",
        rect: { height: TITLE_BAR, width: 240, x: 0, y: 0 },
        selected: false,
        strip: {
          at: 0,
          divided: false,
          first: true,
          open: true,
          rest: undefined,
          tabs: 2,
        },
        tabbed: Layout.Tabbed,
        windows: 2,
      },
    ]);
    // Its windows are laid out under the tabs, with their own title bars.
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
        group: Layout.SplitH,
        id: "a",
        rect: { height: TITLE_BAR, width: 240, x: 0, y: 0 },
        selected: false,
        strip: {
          at: 0,
          divided: false,
          first: true,
          open: false,
          rest: undefined,
          tabs: 2,
        },
        tabbed: Layout.Tabbed,
        windows: 2,
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
