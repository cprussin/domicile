// The one keyboard combination this shell claims: Alt+Enter opens a terminal.
//
// Everything else is deliberately absent, but a desktop you cannot start
// anything from is a demo rather than a desktop — without this, every client
// has to be launched from outside Domicile with two environment variables set
// by hand. A terminal is the one app that fixes that for good: whatever you
// start from it inherits its environment and lands here too.
//
// Claimed in two places, because the keyboard is in two places. Before the
// first window the page has focus and hears the press itself. Once a client
// holds the keyboard the compositor delivers keys straight to it and the page
// hears nothing — which is exactly when another window is wanted, so the
// combination is claimed from the compositor as well and arrives back as a
// `shortcut` message. The two never both fire: either the compositor took the
// key or the page received it.

import type { Shortcut } from "@domicile/chrome-sdk/chrome-message";

/** What Alt+Enter asks the compositor to run. */
const TERMINAL_COMMAND = ["kitty"] as const;

/** Alt+Enter, in the evdev keycodes the protocol speaks. 28 is Enter. */
const ALT_ENTER: Shortcut = {
  alt: true,
  ctrl: false,
  key: 28,
  logo: false,
  shift: false,
};

/** As much of the bridge as opening a terminal needs. */
export type TerminalBridge = {
  grabShortcut: (shortcut: Shortcut) => void;
  on: (type: "shortcut", listener: () => void) => unknown;
  spawn: (command: readonly string[]) => void;
};

/**
 * Open a terminal on Alt+Enter, from whichever half of the desktop hears it.
 *
 * @param keys - What the page listens on, which is the same element the
 *   gestures are installed on. Listened to in the capture phase, so nothing
 *   *below* it sees the chord first, and stopped there so it goes no further:
 *   the SDK forwards keys from `document` to whichever window holds focus, and
 *   without this Alt+Enter would open a terminal *and* land in the window that
 *   was already there.
 */
export const openTerminalOnAltEnter = (
  bridge: TerminalBridge,
  keys: HTMLElement,
): void => {
  const openTerminal = () => {
    bridge.spawn(TERMINAL_COMMAND);
  };

  bridge.grabShortcut(ALT_ENTER);
  // Every claimed press is this one: it is the only combination claimed, so
  // there is nothing to tell apart.
  bridge.on("shortcut", openTerminal);

  keys.addEventListener(
    "keydown",
    (press) => {
      if (isAltEnter(press)) {
        takeKey(press);
        // A held combination repeats at the keyboard's rate, and only the
        // first of them is a request to open anything. The other path never
        // sees a repeat at all.
        if (!press.repeat) {
          openTerminal();
        }
      }
    },
    true,
  );
};

/**
 * Every modifier is part of the chord, exactly as in the claim above — the
 * compositor matches the modifier set it was given and nothing else, so
 * Alt+Shift+Enter is a combination nobody claimed and goes to whichever window
 * holds focus. The page has to agree, or the same keys would open a terminal
 * or reach the client depending on which half happened to hear them.
 */
const isAltEnter = (event: KeyboardEvent): boolean =>
  event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey &&
  event.key === "Enter";

/** Taken whether or not it opened anything: the chord is the desktop's. */
const takeKey = (event: KeyboardEvent): void => {
  event.preventDefault();
  event.stopPropagation();
};
