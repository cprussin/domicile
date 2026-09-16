import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { DomicileShortcut } from "@domicile/chrome-sdk/domicile-host";
import { useEffect } from "react";

/**
 * Alt+Enter, in the evdev keycodes the control channel speaks. 28 is Enter.
 *
 * Every modifier is named rather than left to the dictionary's default. The
 * compositor matches the set it was given and nothing else, so the three that
 * must *not* be held are as much of the chord as the one that must — and the
 * page's own `keydown` branch below has to agree with them, or the same keys
 * would do two different things depending on which half heard them.
 */
const ALT_ENTER: DomicileShortcut = {
  altKey: true,
  ctrlKey: false,
  keycode: 28,
  metaKey: false,
  shiftKey: false,
};

/** Alt+Shift+Tab, the same way. 15 is Tab. */
const ALT_SHIFT_TAB: DomicileShortcut = {
  ...ALT_ENTER,
  keycode: 15,
  shiftKey: true,
};

type Options = {
  domicile: DomicileClient;
  /** Alt+Shift+Tab: take the window the user is working in out of the rail, or put it back. */
  onFloat: () => void;
  /** Alt+Enter: launch a terminal, or with Shift open a browser window. */
  onLaunch: (withShift: boolean) => void;
};

/**
 * The combinations the desktop answers, claimed twice over — because two
 * different things can be holding the keyboard when the user presses one.
 *
 * `grabShortcut` claims the combination for the desktop, and the claim is what
 * decides which of the two answers. A `<webview>` is a browsing context of its
 * own, so a key pressed on a site the shell is showing reaches neither this
 * document nor the compositor: the browser process is the only layer above it,
 * it matches the claim there, and the `shortcut` message is how the press gets
 * back. Every other press lands on this document as a `keydown` — a Wayland
 * window is an `<app>` element and DOM focus never leaves the page — and the
 * branch below is what answers it. The same claim is what keeps the SDK from
 * forwarding the chord to that window on its way past, which is what makes it
 * exactly one of the two paths for any press rather than both.
 */
export const useShortcuts = ({ domicile, onFloat, onLaunch }: Options) => {
  useEffect(() => {
    domicile.grabShortcut(ALT_ENTER);
    domicile.grabShortcut({ ...ALT_ENTER, shiftKey: true });
    domicile.grabShortcut(ALT_SHIFT_TAB);
    // `on` returns the client for chaining, so it is deliberately not returned
    // as a cleanup — there is one handler per message type and re-registering
    // replaces it.
    //
    // The press arrives as the same dictionary that claimed it, so this
    // compares the two field for field without parsing anything.
    domicile.on("shortcut", ({ keycode, shiftKey }) => {
      if (keycode === ALT_SHIFT_TAB.keycode) {
        onFloat();
      } else {
        onLaunch(shiftKey);
      }
    });
  }, [domicile, onFloat, onLaunch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Every modifier is part of the combination, the way the compositor's
      // claim is: Ctrl+Alt+Enter is a combination nobody claimed, and the page
      // is the only path that would otherwise answer it.
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        // Taken from the page whether or not it does anything: the combination
        // is the desktop's for as long as it is held. A held key repeats tens
        // of times a second and only the first of them acts — the compositor
        // never sees a repeat at all — so one press does one thing on either
        // path.
        switch (event.key) {
          case "Enter": {
            event.preventDefault();
            if (!event.repeat) {
              onLaunch(event.shiftKey);
            }
            break;
          }
          // Shift is as much of this chord as Alt is, so a bare Alt+Tab is a
          // combination nobody claimed and the page keeps it — the same thing
          // the compositor does with one, and the reason the claim above is
          // what this compares against rather than a `true` written twice.
          case "Tab": {
            if (event.shiftKey === ALT_SHIFT_TAB.shiftKey) {
              // And the browser's own focus ring, which Tab would otherwise
              // move out from under the window the user is floating.
              event.preventDefault();
              if (!event.repeat) {
                onFloat();
              }
            }
            break;
          }
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onFloat, onLaunch]);
};
