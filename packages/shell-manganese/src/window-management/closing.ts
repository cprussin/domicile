// A window that has closed and is still on screen, on its way out.
//
// Closing is the one thing a window does that the state cannot draw. Every
// other change ends with the desktop as it now is — a window moves, a window
// resizes, and there it is at the new rectangle — while a window that closes
// is gone from the list, from its workspace and from the layout in the same
// reduction, so there is nothing left for a stylesheet to animate. What plays
// out instead is a record of what the window was, held here until it has
// finished leaving.
//
// Not in `window-state.ts` for exactly that reason. The state is what the
// desktop *is*, and a window in the middle of closing is not one of the
// windows the desktop has: it is on no workspace, it holds no keyboard, and
// nothing the user does reaches it.

import type { Placement } from "./placement";
import { LEAVING } from "./placement";
import type { Shown } from "./shown";
import type { ShellWindow } from "./window";

/** A window that has closed, with everything it takes to go on drawing it. */
export type Closing = {
  /**
   * Where it was in the list of windows.
   *
   * So that it goes on being drawn there rather than moved to the end while it
   * leaves: React keeps an element across a re-order by moving it in the
   * document, and a `<webview>` moved in the document reloads the page inside
   * it — which is a browser window going blank for the whole of its own
   * closing animation.
   */
  at: number;
  /**
   * Whether the keyboard was in it.
   *
   * Frozen, because closing a window moves the keyboard to whatever is left:
   * a bar drawn from the desktop as it now is would lose its fill half way
   * through the window's own departure, which is the window changing while the
   * user watches it go.
   */
  focused: boolean;
  /**
   * The box it had, which is where it plays out — raised to {@link LEAVING}.
   *
   * Raised because its neighbours are easing into that box while it shrinks
   * away inside it: left at the depth it had they would cover it before it had
   * gone, two elements at one `z-index` being decided by the order they come
   * in the document.
   */
  placement: Placement;
  window: ShellWindow;
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
  before: Shown,
  windows: readonly ShellWindow[],
): readonly Closing[] =>
  before.windows.flatMap((window, at) => {
    const placement = before.placements.find(({ id }) => id === window.id);
    return windows.some((open) => open.id === window.id) ||
      placement === undefined
      ? []
      : [
          {
            at,
            focused: before.activeId === window.id,
            placement: { ...placement, depth: LEAVING },
            window,
          },
        ];
  });

/**
 * The windows to draw: the open ones, with the closing ones back in the places
 * they had.
 *
 * In ascending order of where they belong, so that two windows closing at once
 * land either side of each other rather than both at the earlier index.
 */
export const withClosing = (
  windows: readonly ShellWindow[],
  closing: readonly Closing[],
): readonly ShellWindow[] =>
  [...closing]
    .sort((one, other) => one.at - other.at)
    .reduce<readonly ShellWindow[]>(
      (drawn, { at, window }) => [
        ...drawn.slice(0, at),
        window,
        ...drawn.slice(at),
      ],
      windows,
    );
