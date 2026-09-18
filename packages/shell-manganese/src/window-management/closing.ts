// A window that has closed and is still on screen, on its way out.
//
// Closing is the one thing a window does that the state cannot draw. Every
// other change ends with the desktop as it now is — a window moves, a window
// resizes, and there it is at the new rectangle — while a window that closes
// is gone from the list, from its workspace and from the layout in the same
// reduction, so there is nothing left for a stylesheet to animate. What plays
// out instead is a record of what the window was: its last box and its name,
// held here until it has finished leaving.
//
// Not in `window-state.ts` for exactly that reason. The state is what the
// desktop *is*, and a window in the middle of closing is not one of the
// windows the desktop has: it is on no workspace, it holds no keyboard, and
// nothing the user does reaches it.

import type { Placement } from "./placement";
import type { ShellWindow } from "./window";

/** A window that has closed, with what it takes to draw it one last time. */
export type Closing = {
  /** The box it last had, which is where it plays out. */
  placement: Placement;
  /** What it was called, which its bar goes on saying while it goes. */
  title: string;
};

/**
 * The windows that were open a moment ago and are not open now, each with the
 * box it had while it still was.
 *
 * A window that closed while it was not on screen is not among them — one on
 * another workspace, or behind another window's tab. There is no rectangle to
 * play it out at, and the one it had last is a rectangle something else is
 * using now.
 */
export const departed = (
  before: readonly ShellWindow[],
  after: readonly ShellWindow[],
  placements: readonly Placement[],
): readonly Closing[] =>
  before
    .filter((window) => !after.some((open) => open.id === window.id))
    .flatMap((window) => {
      const placement = placements.find((found) => found.id === window.id);
      return placement === undefined
        ? []
        : [{ placement, title: window.title }];
    });
