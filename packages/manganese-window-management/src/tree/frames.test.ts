import { describe, expect, it } from "bun:test";

import { WELL_MARGIN } from "../gaps";
import { SURFACE_TUCK, TITLE_BAR } from "../rect";
import { areaOf, framesOf, tabKeyOf } from "./frames";
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

  // As a float's are, so a client's box stays on the pixel grid.
  it("puts every edge of a split on a whole pixel, keeping the gaps", () => {
    const thirds = (layout: Layout.SplitH | Layout.SplitV) =>
      framesOf(
        {
          depth: 1,
          root: LayoutNode.Container(
            layout,
            [LayoutNode.Window("a"), LayoutNode.Window("b")],
            0,
            [1 / 3, 2 / 3],
          ),
        },
        AREA,
        20,
      );
    const row = thirds(Layout.SplitH);
    const column = thirds(Layout.SplitV);

    // 980 shared out a third and two thirds is 326.67 and 653.33.
    expect(frameFor(row, "a").bar).toMatchObject({ width: 327, x: 0 });
    expect(frameFor(row, "b").bar).toMatchObject({ width: 653, x: 347 });
    expect(frameFor(column, "a").bar).toMatchObject({ y: 0 });
    expect(frameFor(column, "b").bar).toMatchObject({ y: 347 });
    expect(frameFor(column, "b").surface).toMatchObject({
      height: 653 - TITLE_BAR + SURFACE_TUCK,
    });
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

  // A tab switch draws the tab it hides there while the new one fades in.
  it("gives the tabs it is not showing the box of the one it is", () => {
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
    /** The group `strip` lays out, which holds `count` windows. */
    const groupOf = (count: number) => ({
      node: { id: "0", up: 1 },
      windows: Array.from({ length: count }, (_, at) => at.toString()),
    });
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
            box: { height: TITLE_BAR, width: 1000, x: 0, y: 0 },
            divided: false,
            end: { height: TITLE_BAR, width: 760, x: 240, y: 0 },
            endDivided: false,
            group: groupOf(1),
            nested: false,
            open: true,
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
            box: { height: TITLE_BAR, width: 1000, x: 0, y: 0 },
            divided: false,
            end: { height: TITLE_BAR, width: 520, x: 480, y: 0 },
            endDivided: true,
            group: groupOf(2),
            nested: false,
            open: true,
            tabs: 2,
          },
          width: 240,
          x: 0,
        },
        {
          strip: {
            at: 1,
            box: { height: TITLE_BAR, width: 1000, x: 0, y: 0 },
            divided: false,
            end: { height: TITLE_BAR, width: 520, x: 480, y: 0 },
            endDivided: true,
            group: groupOf(2),
            nested: false,
            open: false,
            tabs: 2,
          },
          width: 240,
          x: 240,
        },
      ]);
    });

    // The end holds the new-tab button and the group's buttons.
    it("shares out a crowded strip, keeping room for its end", () => {
      const crowded = strip(Layout.Tabbed, 8);

      expect(crowded.map(({ width }) => width)).toEqual(
        Array.from({ length: 8 }, () => 116),
      );
      expect(crowded.at(-1)?.strip).toEqual({
        at: 7,
        box: { height: TITLE_BAR, width: 1000, x: 0, y: 0 },
        divided: true,
        end: { height: TITLE_BAR, width: 72, x: 928, y: 0 },
        endDivided: true,
        group: groupOf(8),
        nested: false,
        open: false,
        tabs: 8,
      });
    });

    it("runs a stack's bars full width, each under a line but the first", () => {
      expect(strip(Layout.Stacking, 2)).toEqual([
        {
          strip: {
            at: 0,
            box: { height: TITLE_BAR * 2, width: 1000, x: 0, y: 0 },
            divided: false,
            end: undefined,
            endDivided: false,
            group: groupOf(2),
            nested: false,
            open: true,
            tabs: 2,
          },
          width: 1000,
          x: 0,
        },
        {
          strip: {
            at: 1,
            box: { height: TITLE_BAR * 2, width: 1000, x: 0, y: 0 },
            divided: true,
            end: undefined,
            endDivided: false,
            group: groupOf(2),
            nested: false,
            open: false,
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

    it("divides the end from a hidden last tab, and not from the open one", () => {
      const endDivided = (focused: number) =>
        framesOf(
          {
            depth: 1,
            root: LayoutNode.Container(
              Layout.Tabbed,
              ["a", "b"].map((id) => LayoutNode.Window(id)),
              focused,
            ),
          },
          AREA,
          0,
        ).frames.map(({ strip }) => strip?.endDivided);

      expect(endDivided(0)).toEqual([true, true]);
      expect(endDivided(1)).toEqual([false, false]);
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
        node: { id: "a", up: 1 },
        rect: { height: TITLE_BAR, width: 240, x: 0, y: 0 },
        selected: false,
        strip: {
          at: 0,
          box: { height: TITLE_BAR, width: 1000, x: 0, y: 0 },
          divided: false,
          end: { height: TITLE_BAR, width: 520, x: 480, y: 0 },
          endDivided: true,
          group: { node: { id: "a", up: 2 }, windows: ["a", "b", "c"] },
          nested: false,
          open: true,
          tabs: 2,
        },
        tabbed: Layout.Tabbed,
        well: { height: 1000 - TITLE_BAR, width: 1000, x: 0, y: TITLE_BAR },
        windows: 2,
      },
    ]);
    // Its windows are laid out in the well, with their own title bars.
    expect(frameFor(tiled, "a").bar).toMatchObject({
      x: WELL_MARGIN,
      y: TITLE_BAR + WELL_MARGIN,
    });
  });

  it("keys apart the tabs of nested groups named after one window", () => {
    // Both groups' tabs are named after "a", the window focus last left.
    const tiled = framesOf(
      {
        depth: 2,
        root: LayoutNode.Container(Layout.Tabbed, [
          LayoutNode.Container(Layout.Tabbed, [
            LayoutNode.Container(Layout.SplitH, [
              LayoutNode.Window("a"),
              LayoutNode.Window("b"),
            ]),
            LayoutNode.Window("c"),
          ]),
          LayoutNode.Window("d"),
        ]),
      },
      AREA,
      0,
    );

    expect(tiled.tabs.map(({ id }) => id)).toEqual(["a", "a"]);
    expect(new Set(tiled.tabs.map((tab) => tabKeyOf(tab))).size).toBe(2);
  });

  it("lays a container out in its well, inset from the well's edges", () => {
    const root = LayoutNode.Container(Layout.Tabbed, [
      LayoutNode.Container(Layout.SplitV, [
        LayoutNode.Window("a"),
        LayoutNode.Window("b"),
      ]),
    ]);
    const tiled = framesOf({ depth: 1, root }, AREA, 0);
    const inset = {
      height: 1000 - TITLE_BAR - 2 * WELL_MARGIN,
      width: 1000 - 2 * WELL_MARGIN,
      x: WELL_MARGIN,
      y: TITLE_BAR + WELL_MARGIN,
    };

    expect(frameFor(tiled, "a").bar).toEqual({
      ...inset,
      height: TITLE_BAR,
    });
    expect(frameFor(tiled, "b").surface).toMatchObject({
      y: inset.y + inset.height / 2 + TITLE_BAR - SURFACE_TUCK,
    });
    // Edge drags measure the same box.
    expect(areaOf(root, [0], AREA, 0)).toEqual(inset);
  });

  it("marks a strip inside a well as nested, and one outside as not", () => {
    const tiled = framesOf(
      {
        depth: 1,
        root: LayoutNode.Container(Layout.Tabbed, [
          LayoutNode.Container(Layout.SplitH, [
            LayoutNode.Container(Layout.Tabbed, [
              LayoutNode.Window("a"),
              LayoutNode.Window("b"),
            ]),
            LayoutNode.Window("c"),
          ]),
        ]),
      },
      AREA,
      0,
    );

    expect(tiled.tabs.map(({ strip }) => strip.nested)).toEqual([false]);
    expect(frameFor(tiled, "a").strip?.nested).toBe(true);
    expect(frameFor(tiled, "c").strip).toBeUndefined();
  });

  it("gives a container no size in a well narrower than its margins", () => {
    const root = LayoutNode.Container(Layout.Tabbed, [
      LayoutNode.Container(Layout.SplitV, [LayoutNode.Window("a")]),
    ]);
    const narrow = {
      height: TITLE_BAR + WELL_MARGIN,
      width: WELL_MARGIN,
      x: 0,
      y: 0,
    };

    expect(areaOf(root, [0], narrow, 0)).toMatchObject({ height: 0, width: 0 });
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
        node: { id: "a", up: 1 },
        rect: { height: TITLE_BAR, width: 240, x: 0, y: 0 },
        selected: false,
        strip: {
          at: 0,
          box: { height: TITLE_BAR, width: 1000, x: 0, y: 0 },
          divided: false,
          end: { height: TITLE_BAR, width: 520, x: 480, y: 0 },
          endDivided: false,
          group: { node: { id: "c", up: 1 }, windows: ["a", "b", "c"] },
          nested: false,
          open: false,
          tabs: 2,
        },
        tabbed: Layout.Tabbed,
        well: undefined,
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
