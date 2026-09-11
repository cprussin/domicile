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

/** Alt+Tab, the same way. 15 is Tab. */
const ALT_TAB: DomicileShortcut = { ...ALT_ENTER, keycode: 15 };

type Options = {
  domicile: DomicileClient;
  /** Alt+Tab: take the window the user is working in out of the rail, or put it back. */
  onFloat: () => void;
  /** Alt+Enter: launch a terminal, or with Shift open a browser window. */
  onLaunch: (withShift: boolean) => void;
};

/**
 * The combinations the desktop answers, claimed twice over — because two
 * different things can be holding the keyboard when the user presses one.
 *
 * `grabShortcut` claims the combination for the desktop, which is what answers
 * when a window has the keyboard: the compositor takes it before a Wayland
 * client is given it, and the browser process takes it before a browser
 * window's page is — a `<domicile-webview>` is a browsing context of its own,
 * so a key pressed on a site the shell is showing reaches neither this page nor
 * the compositor. The page's own `keydown` is what answers when the shell
 * itself has focus. Exactly one of the two paths fires for any press.
 */
export const useShortcuts = ({ domicile, onFloat, onLaunch }: Options) => {
  useEffect(() => {
    domicile.grabShortcut(ALT_ENTER);
    domicile.grabShortcut({ ...ALT_ENTER, shiftKey: true });
    domicile.grabShortcut(ALT_TAB);
    // `on` returns the client for chaining, so it is deliberately not returned
    // as a cleanup — there is one handler per message type and re-registering
    // replaces it.
    //
    // The press arrives as the same dictionary that claimed it, so this
    // compares the two field for field without parsing anything.
    domicile.on("shortcut", ({ keycode, shiftKey }) => {
      if (keycode === ALT_TAB.keycode) {
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
          case "Tab": {
            // And the browser's own focus ring, which Tab would otherwise move
            // out from under the window the user is floating.
            event.preventDefault();
            if (!event.repeat) {
              onFloat();
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
