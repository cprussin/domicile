// biome-ignore-all lint/suspicious/noConsole: what it places is its output

// Puts one window on each display, so a script can ask each client which
// screen it was told it is on.
//
// Driven by scripts/e2e-one-window-per-display.sh. The compositor decides
// which outputs a surface enters from where its portal is, and only a chrome
// can put a portal anywhere — `wayland-info` maps no toplevel, and a client
// left unplaced is on every output by design. So the placement has to come
// from something that speaks the chrome protocol, and this is the smallest
// thing that does.
//
// The two windows are placed by arrival order rather than by name: the app ids
// are the compositor's to assign, and which client mapped first is not
// something a script can arrange. What it prints is which id went where, so
// the caller can match a client's log to the screen it was put on.

import { placePortalMessage } from "@domicile/chrome-sdk/chrome-message";

import {
  connectChromeSocket,
  listenWindowMs,
  requireSocketPath,
} from "./chrome-socket";

/** How long to stay connected once both windows are placed. */
const LISTEN_MS = listenWindowMs(Bun.env);

/** The window size to place, small enough to sit inside either display. */
const SIZE = [400, 300] as const;

/**
 * Where each of the two windows goes, in the desktop's own coordinates.
 *
 * Well inside its display rather than up against the edge, so a rounding
 * disagreement between the placement and the output's rectangle cannot be what
 * this measures. The right display starts at x=1920, so the second window is
 * 400 past its left edge.
 */
const SCREENS = [
  { at: [400, 200], screen: "left" },
  { at: [2320, 200], screen: "right" },
] as const;

const placed: string[] = [];

const chrome = connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    if (message.type === "app_appeared" && placed.length < SCREENS.length) {
      const where = SCREENS[placed.length];
      if (where !== undefined) {
        placed.push(message.app_id);
        chrome.send(
          placePortalMessage({
            appId: message.app_id,
            size: [...SIZE],
            // A plain translation: `size` is the window's own pixels and this
            // is where the page put them, which is what the compositor turns
            // into a rectangle on the desktop.
            transform: [1, 0, 0, 1, where.at[0], where.at[1]],
          }),
        );
        console.log(`placed ${message.app_id} on ${where.screen}`);
      }
    }
  },
});

setTimeout(() => {
  chrome.close();
  process.exit(0);
}, LISTEN_MS);
