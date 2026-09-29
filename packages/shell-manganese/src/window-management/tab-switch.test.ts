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
  surface: CONTENTS,
  tabbed: Layout.Tabbed,
});

const hiddenIn = (id: string): Placement => ({
  bar: BAR,
  behind: CONTENTS,
  depth: 0,
  frame: BAR,
  id,
  surface: undefined,
  tabbed: Layout.Tabbed,
});

const desktop = (placements: readonly Placement[], current = "1"): Shown => ({
  activeId: undefined,
  current,
  placements,
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
    ).toStrictEqual({ concealed: ["a"], revealed: ["b"] });
  });

  // A WINDOW COMING BACK FROM NOWHERE IS NOT A TAB. One that was on another
  // workspace, or in the scratchpad, had nothing on screen to fade from.
  it("leaves a window that was not on screen at all alone", () => {
    expect(
      tabSwitched(
        desktop([shownIn("a")]),
        desktop([hiddenIn("a"), shownIn("b")]),
      ),
    ).toStrictEqual({ concealed: [], revealed: [] });
  });

  // A TAB CLOSING IS NOT A SWITCH. The contents closing fade off the window
  // under them, and that window fading in as well would show the desktop
  // through both.
  it("leaves the window a closed tab uncovers alone", () => {
    expect(
      tabSwitched(
        desktop([shownIn("a"), hiddenIn("b")]),
        desktop([shownIn("b")]),
      ),
    ).toStrictEqual({ concealed: [], revealed: [] });
  });

  it("leaves a window that stays as it was alone", () => {
    expect(
      tabSwitched(
        desktop([shownIn("a"), hiddenIn("b")]),
        desktop([shownIn("a"), hiddenIn("b")]),
      ),
    ).toStrictEqual({ concealed: [], revealed: [] });
  });

  // A window over the tiling is not one the tabs are fading between: the
  // crossfade holds the pair at the tiled depths, and holding a float there
  // would drop it under every window for as long as it plays.
  it("leaves a window that is not tiled alone", () => {
    expect(
      tabSwitched(
        desktop([hiddenIn("a")]),
        desktop([{ ...shownIn("a"), depth: 2000 }]),
      ),
    ).toStrictEqual({ concealed: [], revealed: [] });
  });

  it("says nothing across a workspace switch, which slides the screenful", () => {
    expect(
      tabSwitched(
        desktop([shownIn("a"), hiddenIn("b")]),
        desktop([hiddenIn("a"), shownIn("b")], "2"),
      ),
    ).toStrictEqual({ concealed: [], revealed: [] });
  });
});
