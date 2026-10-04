import { describe, expect, it } from "bun:test";

import { departed, withClosing } from "./closing";
import type { Placement } from "./placement";
import { LEAVING } from "./placement";
import type { Shown } from "./shown";
import { Layout } from "./tree/node";
import { ShellWindow } from "./window";

const TERMINAL = ShellWindow.App("term", "kitty");
const EDITOR = ShellWindow.App("nvim", "nvim");
const MAIL = ShellWindow.App("mail", "mail");

const placementOf = (id: string): Placement => ({
  bar: { height: 30, width: 1200, x: 0, y: 32 },
  behind: undefined,
  depth: 0,
  frame: { height: 800, width: 1200, x: 0, y: 32 },
  id,
  openTab: undefined,
  selected: false,
  surface: { height: 770, width: 1200, x: 0, y: 62 },
  tabbed: undefined,
});

const shown = (windows: readonly ShellWindow[], activeId?: string): Shown => ({
  activeId,
  current: "1",
  placements: windows.map(({ id }) => placementOf(id)),
  tabs: [],
  windows,
});

describe("departed", () => {
  it("keeps a window that is no longer open, with the box it had", () => {
    expect(
      departed(shown([TERMINAL, EDITOR]), [EDITOR]).map(
        ({ placement, window }) => [window.title, placement],
      ),
    ).toStrictEqual([
      ["kitty", { ...placementOf(TERMINAL.id), depth: LEAVING }],
    ]);
  });

  // Focus moves on at once, so the bar must keep its old color while it
  // leaves.
  it("remembers whether the keyboard was in it", () => {
    expect(
      departed(shown([TERMINAL, EDITOR], TERMINAL.id), [EDITOR]).map(
        ({ focused }) => focused,
      ),
    ).toStrictEqual([true]);
  });

  // Otherwise the neighbors easing into its space would cover it before it
  // has gone.
  it("is raised above the windows moving into its place", () => {
    expect(
      departed(shown([TERMINAL, EDITOR]), [EDITOR]).map(
        ({ placement }) => placement.depth,
      ),
    ).toStrictEqual([LEAVING]);
  });

  // At `LEAVING`, a hidden tab's contents would cover the shown window.
  it("draws only the tab of a window a tab was hiding", () => {
    const before = shown([TERMINAL, EDITOR]);
    const hidden = {
      ...placementOf(TERMINAL.id),
      behind: placementOf(TERMINAL.id).surface,
      surface: undefined,
    };

    expect(
      departed({ ...before, placements: [hidden] }, [EDITOR]).map(
        ({ placement }) => [placement.behind, placement.surface],
      ),
    ).toStrictEqual([[undefined, undefined]]);
  });

  // A tab collapses about its own middle, not the window's.
  it("turns a closing tab about the tab itself", () => {
    const before = shown([TERMINAL, EDITOR]);
    const tab: Placement = {
      ...placementOf(TERMINAL.id),
      tabbed: Layout.Tabbed,
    };

    expect(
      departed({ ...before, placements: [tab] }, [EDITOR]).map(
        ({ placement }) => [placement.frame, placement.surface],
      ),
    ).toStrictEqual([[tab.bar, tab.surface]]);
  });

  it("remembers where it was in the list", () => {
    expect(
      departed(shown([TERMINAL, EDITOR, MAIL]), [TERMINAL, MAIL]).map(
        ({ at }) => at,
      ),
    ).toStrictEqual([1]);
  });

  it("says nothing about the windows that are still open", () => {
    expect(departed(shown([TERMINAL]), [TERMINAL])).toStrictEqual([]);
  });

  // It has no rectangle to animate in.
  it("leaves out a window that was not on screen when it closed", () => {
    expect(
      departed(
        {
          activeId: undefined,
          current: "1",
          placements: [],
          tabs: [],
          windows: [TERMINAL],
        },
        [],
      ),
    ).toStrictEqual([]);
  });
});

// A closing window keeps its index: moving a `<webview>` in the document
// reloads its page.
describe("withClosing", () => {
  it("draws a closing window where it was in the list", () => {
    const closing = departed(shown([TERMINAL, EDITOR, MAIL]), [TERMINAL, MAIL]);

    expect(withClosing([TERMINAL, MAIL], closing)).toStrictEqual([
      TERMINAL,
      EDITOR,
      MAIL,
    ]);
  });

  it("draws two of them where they both were", () => {
    const closing = departed(shown([TERMINAL, EDITOR, MAIL]), [EDITOR]);

    expect(withClosing([EDITOR], closing)).toStrictEqual([
      TERMINAL,
      EDITOR,
      MAIL,
    ]);
  });
});
