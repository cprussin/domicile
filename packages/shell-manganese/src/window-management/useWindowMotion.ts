import { useCallback, useState } from "react";

import type { Closing } from "./closing";
import { departed, withClosing } from "./closing";
import type { PlacedTab, Placement } from "./placement";
import type { Restack } from "./restacking";
import { restacked } from "./restacking";
import type { Shown } from "./shown";
import { tabSwitched } from "./tab-switch";
import type { ShellWindow } from "./window";
import type { Shuffle, TabFade, WindowMotion } from "./window-motion";
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
  /**
   * The shuffle it is playing — which way it parts, and the depths it trades —
   * or `undefined` unless its motion is one of the two shuffles.
   */
  restack: Restack | undefined;
  /** The screen it is drawn on, or `undefined` when it is on none. */
  screen: string | undefined;
  window: ShellWindow;
};

/** And one tab, which names a whole container rather than a window. */
export type DrawnTab = {
  focused: boolean;
  motion: WindowMotion;
  /** The screen it is drawn on. */
  screen: string;
  tab: PlacedTab;
};

/** What each screen of the desk shows, by the screen's name. */
type Desk = Readonly<Record<string, Shown>>;

export type WindowMotions = {
  /** The windows to draw, in the order they were opened. */
  drawn: readonly DrawnWindow[];
  /**
   * Called by a window or a bar on `screen` that has finished what it was
   * doing. The screen is what says whose workspace switch has ended.
   */
  onPlayedOut: (
    id: string,
    motion: WindowMotion,
    screen: string | undefined,
  ) => void;
  /** The tabs to draw, the ones sliding off among them. */
  tabs: readonly DrawnTab[];
};

/** A shuffle playing, and which of the two animations it is playing as. */
type Shuffling = { motion: Shuffle; restack: Restack };

/** A window closing, and the screen it is closing on. */
type ClosingOn = Closing & { screen: string };

/** What is still playing out, and so still being drawn. */
type Playing = {
  closing: readonly ClosingOn[];
  /** The windows that have just opened and are still growing in. */
  opening: readonly string[];
  /** The floats still shuffling over, or under, one another. */
  restacking: readonly Shuffling[];
  /**
   * Which of the two shuffles each window was last given, kept after it has
   * played: the next one it is given is the other — see {@link nextShuffle}.
   */
  shuffled: readonly { id: string; motion: Shuffle }[];
  /** The workspace each screen has just switched away from, by screen. */
  switching: Readonly<Record<string, WorkspaceSwitch>>;
  /**
   * The windows a tab switch is crossfading between: the ones fading in, and
   * the ones they are fading in over.
   */
  tabbing: readonly { id: string; motion: TabFade }[];
};

const NOTHING_PLAYING: Playing = {
  closing: [],
  opening: [],
  restacking: [],
  shuffled: [],
  switching: {},
  tabbing: [],
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
 *
 * **One list for the whole desk.** Each window is drawn once, on the screen
 * showing it, so a float dragged onto the next screen is the element it was —
 * and a `<webview>` that stays put is a page that does not load again. A
 * workspace switch is its screen's alone.
 */
export const useWindowMotion = (shown: Desk): WindowMotions => {
  // One state rather than two, so that what was last drawn and what is
  // playing because of it are never out of step: two updates made while
  // rendering are two updates React can keep one of — the desktop the raise
  // was read from kept, and the shuffle it started dropped.
  const [{ before, playing }, setState] = useState({
    before: shown,
    playing: NOTHING_PLAYING,
  });

  if (moved(before, shown)) {
    setState({ before: shown, playing: advanced(playing, before, shown) });
  }

  const onPlayedOut = useCallback(
    (id: string, motion: WindowMotion, screen: string | undefined) => {
      setState((now) => {
        const next = played(now.playing, id, motion, screen);
        return next === now.playing ? now : { ...now, playing: next };
      });
    },
    [],
  );

  return {
    drawn: withClosing(windowsOf(shown), playing.closing).map((window) =>
      drawnWindow(shown, playing, window),
    ),
    onPlayedOut,
    tabs: drawnTabs(shown, playing.switching),
  };
};

/** Whether anything the page draws from has changed since the last render. */
const moved = (before: Desk, shown: Desk): boolean =>
  Object.keys(before).length !== Object.keys(shown).length ||
  Object.entries(shown).some(([name, now]) => {
    const was = before[name];
    return (
      was === undefined ||
      was.activeId !== now.activeId ||
      was.current !== now.current ||
      was.placements !== now.placements ||
      was.tabs !== now.tabs ||
      was.windows !== now.windows
    );
  });

/**
 * The windows the desk has open: every screen's list, which is the same list.
 * None on a desk of no screens, which draws nothing.
 */
const windowsOf = (desk: Desk): readonly ShellWindow[] =>
  Object.values(desk)[0]?.windows ?? [];

/** What is playing once the desktop has moved from `before` to `shown`. */
const advanced = (playing: Playing, before: Desk, shown: Desk): Playing => {
  // The screens there were and still are: one just plugged in has nothing to
  // have moved from.
  const screens = Object.entries(shown).flatMap(([name, now]) => {
    const was = before[name];
    return was === undefined ? [] : [{ name, now, was }];
  });
  const windows = windowsOf(shown);
  const shuffles = screens
    .flatMap(({ now, was }) => restacked(was, now))
    .map((restack) => ({
      motion: nextShuffle(playing, restack.id),
      restack,
    }));
  const switched = screens.map(({ now, was }) => tabSwitched(was, now));
  const fades = [
    ...switched.flatMap(({ concealed }) =>
      concealed.map((id) => ({ id, motion: "concealing" as const })),
    ),
    ...switched.flatMap(({ revealed }) =>
      revealed.map((id) => ({ id, motion: "revealing" as const })),
    ),
  ];
  return {
    closing: [
      ...playing.closing,
      ...screens.flatMap(({ name, now, was }) =>
        departed(was, now.windows).map((closing) => ({
          ...closing,
          screen: name,
        })),
      ),
    ],
    // The ones still open, and the ones that have just appeared. A window that
    // closed while it was still growing in never says it has arrived — it is
    // playing its departure instead — so the ones that are gone are dropped
    // here rather than waiting to be told.
    opening: [
      ...playing.opening.filter((id) => holds(windows, id)),
      ...windows
        .filter(({ id }) => !holds(windowsOf(before), id))
        .map(({ id }) => id),
    ],
    // A window raised again before it has settled plays the latest raise
    // rather than both.
    restacking: [
      ...playing.restacking.filter(
        ({ restack }) =>
          holds(windows, restack.id) && !shuffling(shuffles, restack.id),
      ),
      ...shuffles,
    ],
    shuffled: [
      ...playing.shuffled.filter(
        ({ id }) => holds(windows, id) && !shuffling(shuffles, id),
      ),
      ...shuffles.map(({ motion, restack }) => ({ id: restack.id, motion })),
    ],
    switching: Object.fromEntries(
      screens.flatMap(({ name, now, was }) => {
        const switching = switchedTo(was, now) ?? playing.switching[name];
        return switching === undefined ? [] : [[name, switching]];
      }),
    ),
    // A window switched back before it has finished plays the latest half —
    // which is always the other one, so the browser starts it over.
    tabbing: [
      ...playing.tabbing.filter(
        ({ id }) => holds(windows, id) && !fades.some((fade) => fade.id === id),
      ),
      ...fades,
    ],
  };
};

const holds = (windows: readonly ShellWindow[], id: string): boolean =>
  windows.some((window) => window.id === id);

const shuffling = (shuffles: readonly Shuffling[], id: string): boolean =>
  shuffles.some(({ restack }) => restack.id === id);

/**
 * Which of the two shuffles a window is given next: the one it was not given
 * last.
 *
 * Because a browser starts an animation over only when its name changes. A
 * window raised back while it is still shuffling, or in the frame it finished,
 * would otherwise keep the name it had — and play nothing, and never say it
 * had finished, and be stuck shuffling from then on.
 */
const nextShuffle = (playing: Playing, id: string): Shuffle =>
  playing.shuffled.find((shuffled) => shuffled.id === id)?.motion ===
  "restacking"
    ? "restacking-again"
    : "restacking";

/**
 * What is left playing once `id` on `screen` says it has finished `motion`.
 *
 * The same state back when nothing moved, so that React bails out rather than
 * re-rendering the desktop. Every element of every window that was arriving or
 * leaving says so, and all but the first of them have nothing left to report.
 */
const played = (
  playing: Playing,
  id: string,
  motion: WindowMotion,
  screen: string | undefined,
): Playing => {
  switch (motion) {
    case "arriving-from-end":
    case "arriving-from-start":
    case "leaving-to-end":
    case "leaving-to-start": {
      // Whichever of them speaks first: they were all started together and
      // they all run for the same length, so the first to finish is the
      // switch finishing — on its own screen, whose switch it was.
      return screen === undefined || playing.switching[screen] === undefined
        ? playing
        : {
            ...playing,
            switching: Object.fromEntries(
              Object.entries(playing.switching).filter(
                ([name]) => name !== screen,
              ),
            ),
          };
    }
    case "closing":
    case "closing-tab": {
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
    case "restacking":
    case "restacking-again": {
      // Only the shuffle it is playing now: one it was raised out of is not
      // the one that finished.
      const restacking = playing.restacking.filter(
        (shuffle) => shuffle.restack.id !== id || shuffle.motion !== motion,
      );
      return restacking.length === playing.restacking.length
        ? playing
        : { ...playing, restacking };
    }
    case "concealing":
    case "revealing": {
      const tabbing = playing.tabbing.filter(
        (fade) => fade.id !== id || fade.motion !== motion,
      );
      return tabbing.length === playing.tabbing.length
        ? playing
        : { ...playing, tabbing };
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
  shown: Desk,
  playing: Playing,
  window: ShellWindow,
): DrawnWindow => {
  const closing = playing.closing.find((gone) => gone.window.id === window.id);
  // The screen showing it. One at most: a workspace is on one screen at a
  // time, and a window is on one workspace.
  const placed = Object.entries(shown).flatMap(([screen, { placements }]) => {
    const placement = placements.find(({ id }) => id === window.id);
    return placement === undefined ? [] : [{ placement, screen }];
  })[0];
  if (closing !== undefined) {
    return {
      focused: closing.focused,
      // A tab closes up in its strip rather than shrinking away with its
      // window, and one that was shown fades to the tab taking its place.
      motion:
        closing.placement.tabbed === undefined ? "closing" : "closing-tab",
      placement: closing.placement,
      restack: undefined,
      screen: closing.screen,
      window,
    };
  } else if (placed === undefined) {
    return leavingWindow(playing.switching, window);
  } else {
    const motion = arriving(playing, placed.screen, window.id);
    return {
      focused: shown[placed.screen]?.activeId === window.id,
      motion,
      placement: placed.placement,
      restack: playing.restacking.find(
        (shuffle) =>
          shuffle.restack.id === window.id && shuffle.motion === motion,
      )?.restack,
      screen: placed.screen,
      window,
    };
  }
};

/**
 * How a window that is on `screen` got there, or what it last did there.
 *
 * Arriving outranks a raise: a window that is still growing in or sliding on
 * is not done arriving because something was put over it.
 */
const arriving = (
  playing: Playing,
  screen: string,
  id: string,
): WindowMotion => {
  const switching = playing.switching[screen];
  if (switching !== undefined) {
    return arrivalFrom(switching.towards);
  } else if (playing.opening.includes(id)) {
    return "opening";
  } else {
    return (
      playing.tabbing.find((fade) => fade.id === id)?.motion ??
      playing.restacking.find((shuffle) => shuffle.restack.id === id)?.motion ??
      "resting"
    );
  }
};

/**
 * A window the desktop is not showing: sliding off with the workspace it is
 * on, or simply not drawn.
 *
 * Not drawn covers every other way a window leaves the screen — behind a tab,
 * sent to the scratchpad, left on a workspace nobody is looking at — and none
 * of those is a movement. A window under a fullscreen one is not among them:
 * it keeps the box the layout gives it and is covered rather than taken off
 * the screen, which is what lets the window over it grow and shrink across it.
 * The window is hidden rather than unmounted, which is what keeps its client's
 * surface and its page alive.
 */
const leavingWindow = (
  switching: Playing["switching"],
  window: ShellWindow,
): DrawnWindow => {
  const leaving = Object.entries(switching).flatMap(([screen, left]) => {
    const placement = left.placements.find(({ id }) => id === window.id);
    return placement === undefined ? [] : [{ left, placement, screen }];
  })[0];
  if (leaving === undefined) {
    return {
      focused: false,
      motion: "resting",
      placement: undefined,
      restack: undefined,
      screen: undefined,
      window,
    };
  } else {
    return {
      focused: leaving.left.activeId === window.id,
      motion: departureFor(leaving.left.towards),
      placement: leaving.placement,
      restack: undefined,
      screen: leaving.screen,
      window,
    };
  }
};

/**
 * The tabs on every screen, and the ones the workspace each is leaving had.
 *
 * A tab names a container rather than a window, so nothing about it opens or
 * closes: the only thing a tab can be doing is riding a workspace on or off.
 */
const drawnTabs = (
  shown: Desk,
  switching: Playing["switching"],
): readonly DrawnTab[] =>
  Object.entries(shown).flatMap(([screen, { activeId, tabs }]) => {
    const left = switching[screen];
    return [
      ...tabs.map((tab) => ({
        focused: activeId === tab.id,
        motion:
          left === undefined ? ("resting" as const) : arrivalFrom(left.towards),
        screen,
        tab,
      })),
      ...(left === undefined
        ? []
        : left.tabs.map((tab) => ({
            focused: left.activeId === tab.id,
            motion: departureFor(left.towards),
            screen,
            tab,
          }))),
    ];
  });
