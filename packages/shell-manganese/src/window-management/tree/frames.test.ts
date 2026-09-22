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
    expect(framesOf(NOTHING_TILED, AREA, 0)).toEqual({
      frames: [],
      selection: undefined,
      tabs: [],
    });
  });

  it("gives a lone window the whole area, bar included", () => {
    const tiled = framesOf({ depth: 0, root: LayoutNode.Window("a") }, AREA, 0);

    expect(frameFor(tiled, "a")).toEqual({
      bar: { height: TITLE_BAR, width: 1000, x: 0, y: 0 },
      id: "a",
      surface: {
        height: 1000 - TITLE_BAR,
        width: 1000,
        x: 0,
        y: TITLE_BAR,
      },
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

  it("makes a tabbed container's title bars its tabs", () => {
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
      width: 500,
      x: 0,
      y: 0,
    });
    expect(frameFor(tiled, "b").bar).toMatchObject({ width: 500, x: 500 });
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
        rect: { height: TITLE_BAR, width: 500, x: 0, y: 0 },
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
        rect: { height: TITLE_BAR, width: 500, x: 0, y: 0 },
      },
    ]);
  });

  it("marks out the container `focus parent` selected", () => {
    const tiled = framesOf({ ...COLUMN_BESIDE_A_WINDOW, depth: 1 }, AREA, 0);

    expect(tiled.selection).toEqual({
      height: 1000,
      width: 500,
      x: 500,
      y: 0,
    });
  });

  it("marks nothing out while the commands are pointed at a window", () => {
    expect(framesOf(COLUMN_BESIDE_A_WINDOW, AREA, 0).selection).toBeUndefined();
  });

  it("marks out a container under the tabs it is shown behind", () => {
    const tiled = framesOf(
      {
        depth: 1,
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

    expect(tiled.selection).toEqual({
      height: 1000 - TITLE_BAR,
      width: 1000,
      x: 0,
      y: TITLE_BAR,
    });
  });
});
