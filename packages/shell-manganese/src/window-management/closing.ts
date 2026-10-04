// Closed windows kept on screen while their exit animation plays.
//
// A closed window leaves the state in one reduction, so nothing remains to
// animate. This module keeps a snapshot of it until the animation ends. It
// lives outside `window-state.ts` because a closing window is no longer part
// of the desktop.

import type { Placement } from "./placement";
import { LEAVING } from "./placement";
import type { Shown } from "./shown";
import type { ShellWindow } from "./window";

/** A closed window, with what is needed to keep drawing it. */
export type Closing = {
  /**
   * Its index in the window list.
   *
   * Keeps it in place while it leaves: moving a `<webview>` in the document
   * reloads its page, which would blank the window during the animation.
   */
  at: number;
  /**
   * Whether it had keyboard focus.
   *
   * Frozen at close, since focus moves on at once and the bar would otherwise
   * change color mid-animation.
   */
  focused: boolean;
  /**
   * Its last placement, raised to {@link LEAVING}.
   *
   * Raised so the neighbors easing into its space do not cover it before it
   * has gone.
   */
  placement: Placement;
  window: ShellWindow;
};

/**
 * The windows in `before` that have since closed, with their last placement.
 *
 * Skips windows that were not on screen, such as those on another workspace or
 * behind a tab: they have no rectangle to animate in.
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
            placement: {
              ...placement,
              // A hidden tab's contents, once raised, would cover the shown
              // tab's window.
              behind: undefined,
              depth: LEAVING,
              // A tab collapses about its own middle, not the window's.
              frame:
                placement.tabbed === undefined
                  ? placement.frame
                  : placement.bar,
            },
            window,
          },
        ];
  });

/**
 * The open windows with the closing ones reinserted at their old indices.
 *
 * Inserts in ascending index order so simultaneous closes keep their order.
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
