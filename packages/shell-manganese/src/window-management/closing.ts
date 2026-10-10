// Windows kept on screen while their exit animation plays: closed ones, and
// open ones sent off the screen.
//
// A window leaves the screen in one reduction, so nothing remains to animate.
// This module keeps a snapshot of it until the animation ends. It lives
// outside `window-state.ts` because a closing window is no longer part of the
// desktop.

import type { Placement } from "./placement";
import { LEAVING } from "./placement";
import type { Shown } from "./shown";
import type { ShellWindow } from "./window";

/** A window leaving the screen, with what is needed to keep drawing it. */
export type Leaving = {
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

/** A closed window, with what is needed to keep drawing it. */
export type Closing = Leaving & {
  /**
   * Its index in the window list.
   *
   * Keeps it in place while it leaves: moving a `<webview>` in the document
   * reloads its page, which would blank the window during the animation.
   */
  at: number;
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
      : [{ ...leavingFrom(before, window, placement), at }];
  });

/**
 * The windows `before` showed that are still open but that no screen in
 * `desk` shows: sent to the scratchpad or to an unseen workspace.
 *
 * Skips them when the screen switched workspace from `before` to `now`: they
 * slide off with the workspace instead.
 */
export const sentAway = (
  before: Shown,
  now: Shown,
  desk: readonly Shown[],
): readonly Leaving[] =>
  before.current === now.current
    ? before.placements.flatMap((placement) => {
        const window = now.windows.find(({ id }) => id === placement.id);
        return window === undefined || placedOn(desk, placement.id)
          ? []
          : [leavingFrom(before, window, placement)];
      })
    : [];

/** Whether a screen in `desk` shows the window `id`. */
export const placedOn = (desk: readonly Shown[], id: string): boolean =>
  desk.some(({ placements }) => placements.some((placed) => placed.id === id));

/**
 * Whether a window opens and closes along its tab strip. A group's only tab
 * opens and closes with its group, as a window does.
 */
export const movesAsTab = ({ soleTab, tabbed }: Placement): boolean =>
  tabbed !== undefined && !soleTab;

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

/** The snapshot of `window`, last drawn at `placement`, as it leaves. */
const leavingFrom = (
  before: Shown,
  window: ShellWindow,
  placement: Placement,
): Leaving => ({
  focused: before.activeId === window.id,
  placement: {
    ...placement,
    // A hidden tab's contents, once raised, would cover the shown tab's
    // window.
    behind: undefined,
    depth: LEAVING,
    // A tab collapses about its own middle, not the window's.
    frame: movesAsTab(placement) ? placement.bar : placement.frame,
  },
  window,
});
