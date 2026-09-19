import { useCallback, useState } from "react";

import type { Closing } from "./closing";
import { departed, withClosing } from "./closing";
import type { Placement } from "./placement";
import type { Shown } from "./shown";
import type { Tab } from "./tree/frames";
import type { ShellWindow } from "./window";
import type { WindowMotion } from "./window-motion";
import { arrivalFrom, departureFor } from "./window-motion";
import type { WorkspaceSwitch } from "./workspace-switch";
import { switchedTo } from "./workspace-switch";

/** One window as it is drawn: where it goes, and what it is doing there. */
export type DrawnWindow = {
  /**
   * Whether the keyboard is in it.
   *
   * Frozen for a window on its way off the screen, which is the whole reason
   * this is here rather than worked out where it is drawn: closing a window or
   * leaving a workspace moves the keyboard, and a bar that lost its fill half
   * way through its own departure is the window changing while the user
   * watches it go.
   */
  focused: boolean;
  motion: WindowMotion;
  /** Where it goes, or `undefined` when it is not on screen at all. */
  placement: Placement | undefined;
  window: ShellWindow;
};

/** And one tab, which names a whole container rather than a window. */
export type DrawnTab = {
  focused: boolean;
  motion: WindowMotion;
  tab: Tab;
};

export type WindowMotions = {
  /** The windows to draw, in the order they were opened. */
  drawn: readonly DrawnWindow[];
  /** Called by a window or a bar that has finished what it was doing. */
  onPlayedOut: (id: string, motion: WindowMotion) => void;
  /** The tabs to draw, the ones sliding off among them. */
  tabs: readonly DrawnTab[];
};

/** What is still playing out, and so still being drawn. */
type Playing = {
  closing: readonly Closing[];
  /** The windows that have just opened and are still growing in. */
  opening: readonly string[];
  switching: WorkspaceSwitch | undefined;
};

const NOTHING_PLAYING: Playing = {
  closing: [],
  opening: [],
  switching: undefined,
};

/**
 * What every window on the desktop is doing, and what it takes to draw one
 * that the desktop no longer has.
 *
 * **The desktop as it was, compared against the desktop as it is.** Nothing
 * announces a close or a workspace switch — the reduction that does either
 * does it everywhere at once — so the only place those facts survive is the
 * difference between two renders, which is what `shown` below holds.
 *
 * Worked out while rendering rather than in an effect, which is not a detail:
 * an effect would first commit a render *without* the window that has gone,
 * and React takes an element out of the document the moment it stops being
 * rendered. A `<webview>` put back a frame later is a page reloaded from
 * scratch — a browser window blank for the whole of its own closing animation,
 * which is the one thing a window on its way out must not be.
 *
 * Each of them is let go when it says it has finished rather than when a timer
 * here says so. How long any of this takes is the stylesheet's — see
 * `movingStyles` — and a duration written here as well would be a second copy
 * of it to keep in step.
 */
export const useWindowMotion = (shown: Shown): WindowMotions => {
  const [before, setBefore] = useState(shown);
  const [playing, setPlaying] = useState(NOTHING_PLAYING);

  if (moved(before, shown)) {
    setBefore(shown);
    setPlaying(advanced(playing, before, shown));
  }

  const onPlayedOut = useCallback((id: string, motion: WindowMotion) => {
    setPlaying((playingNow) => played(playingNow, id, motion));
  }, []);

  return {
    drawn: withClosing(shown.windows, playing.closing).map((window) =>
      drawnWindow(shown, playing, window),
    ),
    onPlayedOut,
    tabs: drawnTabs(shown, playing.switching),
  };
};

/** Whether anything the page draws from has changed since the last render. */
const moved = (before: Shown, shown: Shown): boolean =>
  before.activeId !== shown.activeId ||
  before.current !== shown.current ||
  before.placements !== shown.placements ||
  before.tabs !== shown.tabs ||
  before.windows !== shown.windows;

/** What is playing once the desktop has moved from `before` to `shown`. */
const advanced = (playing: Playing, before: Shown, shown: Shown): Playing => ({
  closing: [...playing.closing, ...departed(before, shown.windows)],
  // The ones still open, and the ones that have just appeared. A window that
  // closed while it was still growing in never says it has arrived — it is
  // playing its departure instead — so the ones that are gone are dropped
  // here rather than waiting to be told.
  opening: [
    ...playing.opening.filter((id) => holds(shown.windows, id)),
    ...shown.windows
      .filter(({ id }) => !holds(before.windows, id))
      .map(({ id }) => id),
  ],
  switching: switchedTo(before, shown) ?? playing.switching,
});

const holds = (windows: readonly ShellWindow[], id: string): boolean =>
  windows.some((window) => window.id === id);

/**
 * What is left playing once `id` says it has finished `motion`.
 *
 * The same state back when nothing moved, so that React bails out rather than
 * re-rendering the desktop. Every element of every window that was arriving or
 * leaving says so, and all but the first of them have nothing left to report.
 */
const played = (
  playing: Playing,
  id: string,
  motion: WindowMotion,
): Playing => {
  switch (motion) {
    case "arriving-from-end":
    case "arriving-from-start":
    case "leaving-to-end":
    case "leaving-to-start": {
      // Whichever of them speaks first: they were all started together and
      // they all run for the same length, so the first to finish is the
      // switch finishing.
      return playing.switching === undefined
        ? playing
        : { ...playing, switching: undefined };
    }
    case "closing": {
      const closing = playing.closing.filter(({ window }) => window.id !== id);
      return closing.length === playing.closing.length
        ? playing
        : { ...playing, closing };
    }
    case "opening": {
      const opening = playing.opening.filter((arriving) => arriving !== id);
      return opening.length === playing.opening.length
        ? playing
        : { ...playing, opening };
    }
    case "resting": {
      // A window that is not doing anything cannot have finished doing it.
      // What reaches here is an animation of the chrome's own — a spinner in
      // a browser window's address bar — on its way up the document.
      return playing;
    }
  }
};

const drawnWindow = (
  shown: Shown,
  playing: Playing,
  window: ShellWindow,
): DrawnWindow => {
  const closing = playing.closing.find((gone) => gone.window.id === window.id);
  const placement = shown.placements.find(({ id }) => id === window.id);
  if (closing !== undefined) {
    return {
      focused: closing.focused,
      motion: "closing",
      placement: closing.placement,
      window,
    };
  } else if (placement === undefined) {
    return leavingWindow(playing.switching, window);
  } else {
    return {
      focused: shown.activeId === window.id,
      motion: arriving(playing, window.id),
      placement,
      window,
    };
  }
};

/** How a window that is on screen got there. */
const arriving = (playing: Playing, id: string): WindowMotion => {
  if (playing.switching !== undefined) {
    return arrivalFrom(playing.switching.towards);
  } else if (playing.opening.includes(id)) {
    return "opening";
  } else {
    return "resting";
  }
};

/**
 * A window the desktop is not showing: sliding off with the workspace it is
 * on, or simply not drawn.
 *
 * Not drawn covers every other way a window leaves the screen — behind a tab,
 * under a fullscreen window, sent to the scratchpad — and none of those is a
 * movement. The window is hidden rather than unmounted, which is what keeps
 * its client's surface and its page alive.
 */
const leavingWindow = (
  switching: WorkspaceSwitch | undefined,
  window: ShellWindow,
): DrawnWindow => {
  const placement = switching?.placements.find(({ id }) => id === window.id);
  if (switching === undefined || placement === undefined) {
    return { focused: false, motion: "resting", placement: undefined, window };
  } else {
    return {
      focused: switching.activeId === window.id,
      motion: departureFor(switching.towards),
      placement,
      window,
    };
  }
};

/**
 * The tabs on screen, and the ones the workspace being left had.
 *
 * A tab names a container rather than a window, so nothing about it opens or
 * closes: the only thing a tab can be doing is riding a workspace on or off.
 */
const drawnTabs = (
  shown: Shown,
  switching: WorkspaceSwitch | undefined,
): readonly DrawnTab[] => [
  ...shown.tabs.map((tab) => ({
    focused: shown.activeId === tab.id,
    motion:
      switching === undefined
        ? ("resting" as const)
        : arrivalFrom(switching.towards),
    tab,
  })),
  ...(switching === undefined
    ? []
    : switching.tabs.map((tab) => ({
        focused: switching.activeId === tab.id,
        motion: departureFor(switching.towards),
        tab,
      }))),
];
