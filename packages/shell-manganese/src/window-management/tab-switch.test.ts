import { describe, expect, it } from "bun:test";

import type { Placement } from "./placement";
import type { Rect } from "./rect";
import type { Shown } from "./shown";
import { tabSwitched } from "./tab-switch";
import { Layout } from "./tree/node";

const BAR: Rect = { height: 30, width: 600, x: 0, y: 0 };
const CONTENTS: Rect = { height: 770, width: 1200, x: 0, y: 30 };

const shownIn = (id: string): Placement => ({
  bar: BAR,
  behind: undefined,
  depth: 0,
  frame: { ...CONTENTS, height: 800, y: 0 },
  id,
  selected: false,
  soleTab: false,
  strip: undefined,
  surface: CONTENTS,
  tabbed: Layout.Tabbed,
});

const hiddenIn = (id: string): Placement => ({
  bar: BAR,
  behind: CONTENTS,
  depth: 0,
  frame: BAR,
  id,
  selected: false,
  soleTab: false,
  strip: undefined,
  surface: undefined,
  tabbed: Layout.Tabbed,
});

const desktop = (placements: readonly Placement[], current = "1"): Shown => ({
  activeId: undefined,
  current,
  placements,
  scratchpad: [],
  tabs: [],
  windows: [],
});

describe("tabSwitched", () => {
  it("names the window a tab has revealed and the one it has hidden", () => {
    expect(
      tabSwitched(
        desktop([shownIn("a"), hiddenIn("b")]),
        desktop([hiddenIn("a"), shownIn("b")]),
      ),
    ).toStrictEqual({ concealed: ["a"], revealed: ["b"], uncovered: [] });
  });

  // A window opened as a tab, or brought from another workspace, is not
  // revealed. The tab it hides stays drawn under it while it arrives, so the
  // desktop does not show through.
  it("conceals the tab a window arriving in its box hides", () => {
    expect(
      tabSwitched(
        desktop([shownIn("a")]),
        desktop([hiddenIn("a"), shownIn("b")]),
      ),
    ).toStrictEqual({ concealed: ["a"], revealed: [], uncovered: [] });
  });

  // A tab closing is not a switch; fading both would show the desktop
  // through.
  it("names the window a closed tab uncovers apart from a switch", () => {
    expect(
      tabSwitched(
        desktop([shownIn("a"), hiddenIn("b")]),
        desktop([shownIn("b")]),
      ),
    ).toStrictEqual({ concealed: [], revealed: [], uncovered: ["b"] });
  });

  it("leaves a window that stays as it was alone", () => {
    expect(
      tabSwitched(
        desktop([shownIn("a"), hiddenIn("b")]),
        desktop([shownIn("a"), hiddenIn("b")]),
      ),
    ).toStrictEqual({ concealed: [], revealed: [], uncovered: [] });
  });

  // Floats are skipped; the crossfade's tiled depth would drop a float under
  // every window.
  it("leaves a window that is not tiled alone", () => {
    expect(
      tabSwitched(
        desktop([hiddenIn("a")]),
        desktop([{ ...shownIn("a"), depth: 2000 }]),
      ),
    ).toStrictEqual({ concealed: [], revealed: [], uncovered: [] });
  });

  it("says nothing across a workspace switch, which slides the screenful", () => {
    expect(
      tabSwitched(
        desktop([shownIn("a"), hiddenIn("b")]),
        desktop([hiddenIn("a"), shownIn("b")], "2"),
      ),
    ).toStrictEqual({ concealed: [], revealed: [], uncovered: [] });
  });
});
