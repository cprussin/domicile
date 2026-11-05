import { describe, expect, it } from "bun:test";

import { crossed } from "./crossing";
import type { Placement } from "./placement";
import { TILED } from "./placement";
import type { Rect } from "./rect";
import type { Shown } from "./shown";
import { Layout } from "./tree/node";

const LEFT: Rect = { height: 400, width: 600, x: 0, y: 0 };
const RIGHT: Rect = { height: 400, width: 600, x: 600, y: 0 };

/** Window `id` in a tab group holding `group`, open unless `hidden`. */
const tab = (
  id: string,
  group: readonly string[],
  area: Rect,
  { depth = TILED, hidden = false } = {},
): Placement => ({
  bar: { ...area, height: 30 },
  bare: false,
  behind: undefined,
  depth,
  frame: area,
  id,
  selected: false,
  soleTab: group.length === 1,
  strip: {
    area,
    at: group.indexOf(id),
    box: { ...area, height: 30 },
    divided: false,
    end: undefined,
    endDivided: false,
    group: { node: { id: group[0] ?? id, up: 1 }, wells: 0, windows: group },
    nested: false,
    open: !hidden,
    tabs: group.length,
  },
  surface: hidden ? undefined : { ...area, height: 370, y: area.y + 30 },
  tabbed: Layout.Tabbed,
});

/** A desk of one screen. */
const screen = (shown: Shown) => ({ screen: shown });

const desktop = (placements: readonly Placement[], current = "1"): Shown => ({
  activeId: undefined,
  current,
  placements,
  scratchpad: [],
  tabs: [],
  windows: [],
});

describe("crossed", () => {
  it("is a window that joined another group", () => {
    expect(
      crossed(
        screen(desktop([tab("a", ["a"], LEFT), tab("b", ["b"], RIGHT)])),
        screen(
          desktop([
            tab("a", ["b", "a"], RIGHT),
            tab("b", ["b", "a"], RIGHT, { hidden: true }),
          ]),
        ),
      ),
    ).toStrictEqual(new Set(["a"]));
  });

  it("is a window that left its group", () => {
    expect(
      crossed(
        screen(
          desktop([
            tab("a", ["a", "b"], LEFT),
            tab("b", ["a", "b"], LEFT, { hidden: true }),
          ]),
        ),
        screen(desktop([tab("a", ["a"], RIGHT), tab("b", ["b"], LEFT)])),
      ),
    ).toContain("a");
  });

  // Each screen has its own `Shown`.
  it("is a window that joined a group on another screen", () => {
    expect(
      crossed(
        {
          left: desktop([tab("a", ["a"], LEFT)]),
          right: desktop([tab("b", ["b"], RIGHT)]),
        },
        {
          left: desktop([]),
          right: desktop([
            tab("a", ["b", "a"], RIGHT),
            tab("b", ["b", "a"], RIGHT, { hidden: true }),
          ]),
        },
      ),
    ).toStrictEqual(new Set(["a"]));
  });

  it("is not a window moving along its own strip", () => {
    expect(
      crossed(
        screen(
          desktop([
            tab("a", ["a", "b"], LEFT),
            tab("b", ["a", "b"], LEFT, { hidden: true }),
          ]),
        ),
        screen(
          desktop([
            tab("a", ["b", "a"], LEFT),
            tab("b", ["b", "a"], LEFT, { hidden: true }),
          ]),
        ),
      ),
    ).toStrictEqual(new Set());
  });

  it("is not a group that another window joined", () => {
    expect(
      crossed(
        screen(
          desktop([
            tab("a", ["a"], LEFT),
            tab("b", ["b", "c"], RIGHT),
            tab("c", ["b", "c"], RIGHT, { hidden: true }),
          ]),
        ),
        screen(
          desktop([
            tab("a", ["b", "c", "a"], RIGHT),
            tab("b", ["b", "c", "a"], RIGHT, { hidden: true }),
            tab("c", ["b", "c", "a"], RIGHT, { hidden: true }),
          ]),
        ),
      ),
    ).toStrictEqual(new Set(["a"]));
  });

  // Floats already draw over every tiled strip.
  it("is only between tiled groups", () => {
    expect(
      crossed(
        screen(
          desktop([
            tab("a", ["a"], LEFT, { depth: 2 }),
            tab("b", ["b"], RIGHT, { depth: 2 }),
          ]),
        ),
        screen(
          desktop([
            tab("a", ["b", "a"], RIGHT, { depth: 2 }),
            tab("b", ["b", "a"], RIGHT, { depth: 2, hidden: true }),
          ]),
        ),
      ),
    ).toStrictEqual(new Set());
  });

  // A workspace switch slides the whole screen instead.
  it("is nothing across a workspace switch", () => {
    expect(
      crossed(
        screen(desktop([tab("a", ["a"], LEFT), tab("b", ["b"], RIGHT)], "1")),
        screen(
          desktop(
            [
              tab("a", ["b", "a"], RIGHT),
              tab("b", ["b", "a"], RIGHT, { hidden: true }),
            ],
            "2",
          ),
        ),
      ),
    ).toStrictEqual(new Set());
  });
});
