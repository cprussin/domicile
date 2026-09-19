import { describe, expect, it } from "bun:test";

import { departed, withClosing } from "./closing";
import type { Placement } from "./placement";
import { LEAVING } from "./placement";
import type { Shown } from "./shown";
import { ShellWindow } from "./window";

const TERMINAL = ShellWindow.App("term", "kitty");
const EDITOR = ShellWindow.App("nvim", "nvim");
const MAIL = ShellWindow.App("mail", "mail");

const placementOf = (id: string): Placement => ({
  bar: { height: 30, width: 1200, x: 0, y: 32 },
  depth: 0,
  frame: { height: 800, width: 1200, x: 0, y: 32 },
  id,
  surface: { height: 770, width: 1200, x: 0, y: 62 },
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

  // WHAT IT SAID, IT GOES ON SAYING. Closing a window moves the keyboard to
  // whatever is left, so a bar drawn from the desktop as it now is would lose
  // its fill half way through the window's own departure.
  it("remembers whether the keyboard was in it", () => {
    expect(
      departed(shown([TERMINAL, EDITOR], TERMINAL.id), [EDITOR]).map(
        ({ focused }) => focused,
      ),
    ).toStrictEqual([true]);
  });

  // AND IS DRAWN OVER THE WINDOWS CLOSING OVER ITS SPACE. They ease into the
  // box it had while it shrinks away inside it, and at the depth it used to
  // have they would cover it before it had gone — two elements at one
  // `z-index` are decided by the order they come in the document, and this one
  // goes on being drawn where it always was.
  it("is raised above the windows moving into its place", () => {
    expect(
      departed(shown([TERMINAL, EDITOR]), [EDITOR]).map(
        ({ placement }) => placement.depth,
      ),
    ).toStrictEqual([LEAVING]);
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

  // A window closed on a workspace nobody is looking at has no rectangle to
  // play out at, and the one it had belongs to whatever is on screen now.
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

// A window is drawn where it always was, rather than moved to the end of the
// list while it goes: a `<webview>` moved in the document reloads the page
// inside it, which is a browser window going blank for the length of its own
// closing animation.
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
