import { describe, expect, it } from "bun:test";

import { holdableWindows } from "./holdable-windows";
import type { Placement } from "./placement";
import type { Rect } from "./rect";
import type { DrawnWindow } from "./useWindowMotion";
import { ShellWindow } from "./window";
import type { WindowMotion } from "./window-motion";

const FRAME: Rect = { height: 300, width: 400, x: 0, y: 40 };

const placed = (id: string): Placement => ({
  bar: { ...FRAME, height: 30 },
  bare: false,
  behind: undefined,
  depth: 4,
  frame: FRAME,
  id,
  selected: false,
  soleTab: false,
  strip: undefined,
  surface: { ...FRAME, height: 270, y: 70 },
  tabbed: undefined,
});

const drawn = (
  window: ShellWindow,
  placement: Placement | undefined = placed(window.id),
  motion: WindowMotion = "resting",
): DrawnWindow => ({
  crossing: false,
  focused: false,
  motion,
  placement,
  restack: undefined,
  revealedFrom: undefined,
  rewound: 0,
  screen: "left",
  shownRewound: 0,
  window,
});

const report = ShellWindow.App("report", "Expense report");

describe("holdableWindows", () => {
  it("lists a client window at rest on screen, by its app id", () => {
    expect(holdableWindows([drawn(report)])).toStrictEqual([
      { appId: "report", depth: 4, frame: FRAME },
    ]);
  });

  it("leaves out a window that moves, so nothing trails it", () => {
    expect(
      holdableWindows([drawn(report, placed(report.id), "opening")]),
    ).toStrictEqual([]);
  });

  it("leaves out a hidden tab and a window off screen", () => {
    expect(
      holdableWindows([
        drawn(report, {
          ...placed(report.id),
          behind: FRAME,
          surface: undefined,
        }),
        { ...drawn(report), placement: undefined },
      ]),
    ).toStrictEqual([]);
  });

  it("lists a browser window by the engine's id for it, which seats name", () => {
    expect(
      holdableWindows([
        drawn(
          ShellWindow.Browser(
            "1",
            "https://example.com/",
            "Example",
            undefined,
            false,
            true,
            "report",
          ),
        ),
      ]),
    ).toStrictEqual([{ appId: "1", depth: 4, frame: FRAME }]);
  });
});
