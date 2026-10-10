import { useCallback, useState } from "react";

import { token } from "../../styled-system/tokens";

import type { Closing, Leaving } from "./closing";
import { departed, movesAsTab, sentAway, withClosing } from "./closing";
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

/** A window to draw: its placement and motion. */
export type DrawnWindow = {
  /**
   * Whether the window has keyboard focus.
   *
   * Frozen while the window leaves, since closing or switching moves focus and
   * the bar should not change mid-animation.
   */
  focused: boolean;
  motion: WindowMotion;
  /** The window's placement, or `undefined` when it is off screen. */
  placement: Placement | undefined;
  /** The shuffle the window is playing, or `undefined` when not shuffling. */
  restack: Restack | undefined;
  /**
   * How far into its motion the window starts, in milliseconds. A scratchpad
   * slide that cuts the other short starts where that one had got to; every
   * other motion starts at 0.
   */
  rewound: number;
  /** The screen the window is drawn on, or `undefined` for none. */
  screen: string | undefined;
  window: ShellWindow;
};

/** A tab to draw. A tab names a container, not a window. */
export type DrawnTab = {
  focused: boolean;
  motion: WindowMotion;
  /** The screen it is drawn on. */
  screen: string;
  tab: PlacedTab;
};

/** What each screen shows, by screen name. */
type Desk = Readonly<Record<string, Shown>>;

export type WindowMotions = {
  /** The windows to draw, in the order they were opened. */
  drawn: readonly DrawnWindow[];
  /**
   * Called when a window or bar on `screen` finishes an animation. `screen`
   * identifies which workspace switch ended.
   */
  onPlayedOut: (
    id: string,
    motion: WindowMotion,
    screen: string | undefined,
  ) => void;
  /** The tabs to draw, including ones sliding off. */
  tabs: readonly DrawnTab[];
};

/** A playing shuffle and which of the two animation names it uses. */
type Shuffling = { motion: Shuffle; restack: Restack };

/** A closing window and its screen. */
type ClosingOn = Closing & { screen: string };

/**
 * When a scratchpad slide began, and how far into its animation, in
 * milliseconds. See {@link rewoundAfter}.
 */
type Slid = { at: number; rewound: number };

/** An open window sent off the screen, how it leaves, and from which screen. */
type SendingOn = Leaving &
  Slid & {
    motion: "sending" | "sending-tab" | "stowing";
    screen: string;
  };

/** Animations still playing. */
type Playing = {
  closing: readonly ClosingOn[];
  /** Windows still sliding down from the scratchpad. */
  dropping: readonly (Slid & { id: string })[];
  /** Windows still playing their opening animation. */
  opening: readonly string[];
  /** Floats still shuffling in the stack. */
  restacking: readonly Shuffling[];
  /** Open windows leaving the screen. */
  sending: readonly SendingOn[];
  /**
   * Each window's last shuffle name, kept after it ends so the next uses the
   * other (see {@link nextShuffle}).
   */
  shuffled: readonly { id: string; motion: Shuffle }[];
  /** The workspace each screen is switching away from, by screen. */
  switching: Readonly<Record<string, WorkspaceSwitch>>;
  /** The windows in a tab switch crossfade. */
  tabbing: readonly { id: string; motion: TabFade }[];
};

const NOTHING_PLAYING: Playing = {
  closing: [],
  dropping: [],
  opening: [],
  restacking: [],
  sending: [],
  shuffled: [],
  switching: {},
  tabbing: [],
};

/**
 * Each window's animation state, including windows the desktop has removed but
 * that are still animating out.
 *
 * Closes and workspace switches are detected by comparing the previous and
 * current desk. This runs during render, not in an effect: an effect would
 * first commit a render without the closed window, and React would unmount its
 * `<webview>`, blanking the page during the close animation.
 *
 * Animations end when the element reports it, so durations live in the
 * stylesheet (see `movingStyles`). Only the scratchpad slides' is read here, to
 * start one where the other was cut short.
 *
 * One list covers the whole desk, so a float dragged to another screen keeps
 * its element and its `<webview>` does not reload.
 */
export const useWindowMotion = (
  shown: Desk,
  now: () => number = () => performance.now(),
): WindowMotions => {
  // One state, not two: React may keep only one of two updates made during
  // render, which would desync the last desk from the animations it started.
  const [{ before, playing }, setState] = useState({
    before: shown,
    playing: NOTHING_PLAYING,
  });

  if (moved(before, shown)) {
    setState({
      before: shown,
      playing: advanced(playing, before, shown, now()),
    });
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

  const index = indexOf(shown, playing);
  return {
    drawn: withClosing(windowsOf(shown), playing.closing).map((window) =>
      drawnWindow(shown, playing, index, window),
    ),
    onPlayedOut,
    tabs: drawnTabs(shown, playing.switching),
  };
};

/** Whether anything drawn has changed since the last render. */
const moved = (before: Desk, shown: Desk): boolean =>
  Object.keys(before).length !== Object.keys(shown).length ||
  Object.entries(shown).some(([name, now]) => {
    const was = before[name];
    return (
      was === undefined ||
      was.activeId !== now.activeId ||
      was.current !== now.current ||
      was.placements !== now.placements ||
      was.scratchpad !== now.scratchpad ||
      was.tabs !== now.tabs ||
      was.windows !== now.windows
    );
  });

/**
 * The desk's open windows. Every screen has the same list; an empty desk has
 * none.
 */
const windowsOf = (desk: Desk): readonly ShellWindow[] =>
  Object.values(desk)[0]?.windows ?? [];

/**
 * What is playing after the desk changes from `before` to `shown` at `time`.
 */
const advanced = (
  playing: Playing,
  before: Desk,
  shown: Desk,
  time: number,
): Playing => {
  // Only screens present in both renders; a new screen has no prior state.
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
  // Sets, since every window is checked against them.
  const open = new Set(windows.map(({ id }) => id));
  const wasOpen = new Set(windowsOf(before).map(({ id }) => id));
  const shownIds = placedIds(shown);
  const fades = [
    ...switched.flatMap(({ concealed }) =>
      concealed.map((id) => ({ id, motion: "concealing" as const })),
    ),
    ...switched.flatMap(({ revealed }) =>
      revealed.map((id) => ({ id, motion: "revealing" as const })),
    ),
    ...switched.flatMap(({ uncovered }) =>
      uncovered.map((id) => ({ id, motion: "uncovering" as const })),
    ),
  ];
  const fading = new Set(fades.map(({ id }) => id));
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
    // Drop windows no longer shown: they never report the slide finished.
    dropping: [
      ...playing.dropping.filter(({ id }) => shownIds.has(id)),
      ...windows
        .filter(
          ({ id }) =>
            stowed(before, id) && !stowed(shown, id) && shownIds.has(id),
        )
        .map(({ id }) => ({
          at: time,
          id,
          rewound: rewoundAfter(
            playing.sending.find(
              (sending) =>
                sending.window.id === id && sending.motion === "stowing",
            ),
            time,
          ),
        })),
    ],
    // Drop windows closed or hidden while opening: they never report the
    // opening finished.
    opening: [
      ...playing.opening.filter((id) => shownIds.has(id)),
      ...windows.filter(({ id }) => !wasOpen.has(id)).map(({ id }) => id),
    ],
    // A window raised again before settling plays only the latest raise.
    restacking: [
      ...playing.restacking.filter(
        ({ restack }) =>
          open.has(restack.id) && !shuffling(shuffles, restack.id),
      ),
      ...shuffles,
    ],
    // Drop windows shown again or closed: neither finishes leaving.
    sending: [
      ...playing.sending.filter(
        ({ window }) => open.has(window.id) && !shownIds.has(window.id),
      ),
      ...screens.flatMap(({ name, now, was }) =>
        sentAway(was, now, Object.values(shown)).map((sending) => {
          const motion = sendingMotion(shown, sending);
          return {
            ...sending,
            at: time,
            motion,
            rewound:
              motion === "stowing"
                ? rewoundAfter(
                    playing.dropping.find(({ id }) => id === sending.window.id),
                    time,
                  )
                : 0,
            screen: name,
          };
        }),
      ),
    ],
    shuffled: [
      ...playing.shuffled.filter(
        ({ id }) => open.has(id) && !shuffling(shuffles, id),
      ),
      ...shuffles.map(({ motion, restack }) => ({ id: restack.id, motion })),
    ],
    switching: Object.fromEntries(
      screens.flatMap(({ name, now, was }) => {
        const switching = switchedTo(was, now) ?? playing.switching[name];
        return switching === undefined ? [] : [[name, switching]];
      }),
    ),
    // A window switched back mid-fade plays the latest half, which always
    // differs from the current one, so the browser restarts it.
    tabbing: [
      ...playing.tabbing.filter(({ id }) => open.has(id) && !fading.has(id)),
      ...fades,
    ],
  };
};

/**
 * How long a scratchpad slide takes, in milliseconds. Matches `dropping` and
 * `stowing` in `movingStyles`.
 */
const SLIDE = Number.parseFloat(token("durations.slow"));

/**
 * How far into a scratchpad slide starting at `time` to begin, given the
 * opposite slide it cuts short, if any.
 *
 * Each slide is the other played backwards, so starting at the time the cut
 * slide has left puts the window where that slide had moved it.
 */
const rewoundAfter = (cut: Slid | undefined, time: number): number =>
  cut === undefined ? 0 : Math.max(0, SLIDE - (cut.rewound + time - cut.at));

/** Whether the desk has the window `id` in the scratchpad. */
const stowed = (desk: Desk, id: string): boolean =>
  Object.values(desk)[0]?.scratchpad.includes(id) ?? false;

/**
 * How a window leaves the screen: up to the scratchpad, or off to another
 * workspace.
 */
const sendingMotion = (
  desk: Desk,
  { placement }: Leaving,
): SendingOn["motion"] => {
  if (stowed(desk, placement.id)) {
    return "stowing";
  } else {
    return movesAsTab(placement) ? "sending-tab" : "sending";
  }
};

/** The windows the desk's screens place. */
const placedIds = (desk: Desk): ReadonlySet<string> =>
  new Set(
    Object.values(desk).flatMap(({ placements }) =>
      placements.map(({ id }) => id),
    ),
  );

const shuffling = (shuffles: readonly Shuffling[], id: string): boolean =>
  shuffles.some(({ restack }) => restack.id === id);

/**
 * The shuffle name a window gets next: the one it did not get last.
 *
 * Browsers restart an animation only when its name changes. Reusing a name
 * would play nothing, never report completion, and leave the window stuck.
 */
const nextShuffle = (playing: Playing, id: string): Shuffle =>
  playing.shuffled.find((shuffled) => shuffled.id === id)?.motion ===
  "restacking"
    ? "restacking-again"
    : "restacking";

/**
 * What is left playing after `id` on `screen` finishes `motion`.
 *
 * Returns the same object when nothing changed so React skips the re-render.
 * Every element of an animating window reports, and only the first matters.
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
      // The first report ends the switch on its screen: all its animations
      // start together and run equally long.
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
    case "sending":
    case "sending-tab":
    case "stowing": {
      const sending = playing.sending.filter(({ window }) => window.id !== id);
      return sending.length === playing.sending.length
        ? playing
        : { ...playing, sending };
    }
    case "dropping": {
      const dropping = playing.dropping.filter((shown) => shown.id !== id);
      return dropping.length === playing.dropping.length
        ? playing
        : { ...playing, dropping };
    }
    case "opening":
    case "opening-tab": {
      const opening = playing.opening.filter((arriving) => arriving !== id);
      return opening.length === playing.opening.length
        ? playing
        : { ...playing, opening };
    }
    case "restacking":
    case "restacking-again": {
      // Match the current shuffle only, not one it was raised out of.
      const restacking = playing.restacking.filter(
        (shuffle) => shuffle.restack.id !== id || shuffle.motion !== motion,
      );
      return restacking.length === playing.restacking.length
        ? playing
        : { ...playing, restacking };
    }
    case "concealing":
    case "revealing":
    case "uncovering": {
      const tabbing = playing.tabbing.filter(
        (fade) => fade.id !== id || fade.motion !== motion,
      );
      return tabbing.length === playing.tabbing.length
        ? playing
        : { ...playing, tabbing };
    }
    case "resting": {
      // A resting window has nothing to finish. These events come from chrome
      // animations, such as the address bar spinner, bubbling up.
      return playing;
    }
  }
};

/** Where each window is, by id, built once per render. */
type Index = {
  closing: ReadonlyMap<string, ClosingOn>;
  /** The departing workspace's placement of each window sliding off. */
  leaving: ReadonlyMap<
    string,
    { left: WorkspaceSwitch; placement: Placement; screen: string }
  >;
  /**
   * Each shown window's placement. At most one screen shows it: a workspace
   * is on one screen, and a window on one workspace.
   */
  placed: ReadonlyMap<string, { placement: Placement; screen: string }>;
  sending: ReadonlyMap<string, SendingOn>;
};

/**
 * Keys each list by window. Reversed, so the first entry for a window wins, as
 * `find` would.
 */
const indexOf = (shown: Desk, playing: Playing): Index => ({
  closing: new Map(
    playing.closing.toReversed().map((gone) => [gone.window.id, gone]),
  ),
  leaving: new Map(
    Object.entries(playing.switching)
      .flatMap(([screen, left]) =>
        left.placements.map(
          (placement) => [placement.id, { left, placement, screen }] as const,
        ),
      )
      .toReversed(),
  ),
  placed: new Map(
    Object.entries(shown)
      .flatMap(([screen, { placements }]) =>
        placements.map(
          (placement) => [placement.id, { placement, screen }] as const,
        ),
      )
      .toReversed(),
  ),
  sending: new Map(
    playing.sending.toReversed().map((gone) => [gone.window.id, gone]),
  ),
});

const drawnWindow = (
  shown: Desk,
  playing: Playing,
  index: Index,
  window: ShellWindow,
): DrawnWindow => {
  const closing = index.closing.get(window.id);
  const placed = index.placed.get(window.id);
  if (closing !== undefined) {
    return {
      focused: closing.focused,
      // A tab closes within its strip instead of shrinking with its window, and
      // a shown tab fades to the tab replacing it.
      motion: movesAsTab(closing.placement) ? "closing-tab" : "closing",
      placement: closing.placement,
      restack: undefined,
      rewound: 0,
      screen: closing.screen,
      window,
    };
  } else if (placed === undefined) {
    const sending = index.sending.get(window.id);
    return sending === undefined
      ? leavingWindow(index, window)
      : {
          focused: sending.focused,
          motion: sending.motion,
          placement: sending.placement,
          restack: undefined,
          rewound: sending.rewound,
          screen: sending.screen,
          window,
        };
  } else {
    const motion = arriving(playing, placed.screen, placed.placement);
    return {
      focused: shown[placed.screen]?.activeId === window.id,
      motion,
      placement: placed.placement,
      restack: playing.restacking.find(
        (shuffle) =>
          shuffle.restack.id === window.id && shuffle.motion === motion,
      )?.restack,
      // Only a slide reads it, so a drop outranked by another motion can keep
      // it. One not dropping starts at the beginning.
      rewound:
        playing.dropping.find(({ id }) => id === window.id)?.rewound ?? 0,
      screen: placed.screen,
      window,
    };
  }
};

/**
 * The motion of a window on `screen`.
 *
 * Arrival outranks a raise: a raise does not end a window's arrival.
 */
const arriving = (
  playing: Playing,
  screen: string,
  placement: Placement,
): WindowMotion => {
  const { id } = placement;
  const switching = playing.switching[screen];
  if (switching !== undefined) {
    return arrivalFrom(switching.towards);
  } else if (playing.opening.includes(id)) {
    return movesAsTab(placement) ? "opening-tab" : "opening";
  } else if (playing.dropping.some((dropping) => dropping.id === id)) {
    return "dropping";
  } else {
    return (
      playing.tabbing.find((fade) => fade.id === id)?.motion ??
      playing.restacking.find((shuffle) => shuffle.restack.id === id)?.motion ??
      "resting"
    );
  }
};

/**
 * A window not on screen: either sliding off with its workspace or not drawn.
 *
 * Hidden windows (behind a tab, in the scratchpad, on an unseen workspace) stay
 * mounted to keep their surface and page alive. Windows under a fullscreen
 * window are not in this group: they keep their box and are covered.
 */
const leavingWindow = (index: Index, window: ShellWindow): DrawnWindow => {
  const leaving = index.leaving.get(window.id);
  if (leaving === undefined) {
    return {
      focused: false,
      motion: "resting",
      placement: undefined,
      restack: undefined,
      rewound: 0,
      screen: undefined,
      window,
    };
  } else {
    return {
      focused: leaving.left.activeId === window.id,
      motion: departureFor(leaving.left.towards),
      placement: leaving.placement,
      restack: undefined,
      rewound: 0,
      screen: leaving.screen,
      window,
    };
  }
};

/**
 * The tabs on every screen, plus those of the workspace each screen is leaving.
 *
 * Tabs never open or close; they only slide with a workspace.
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
