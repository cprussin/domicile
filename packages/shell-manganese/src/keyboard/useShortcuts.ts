import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useEffect } from "react";

import type {
  BindingMode,
  WindowAction,
} from "../window-management/window-state";
import { actionForCode, actionForKeycode, CHORDS } from "./bindings";

type Options = {
  domicile: DomicileClient;
  /** Which set of bindings is live — the default one, or resize mode. */
  mode: BindingMode;
  /** What the desktop is being asked to do. */
  onAction: (action: WindowAction) => void;
};

/**
 * The keys the desktop answers, claimed twice over — because two different
 * things can be holding the keyboard when one is pressed.
 *
 * `grabShortcut` claims the chord for the desktop, and the claim is what
 * decides which of the two paths answers. A `<webview>` is a browsing context
 * of its own, so a key pressed on a site the shell is showing reaches neither
 * this document nor the compositor: the browser process is the only layer
 * above it, it matches the claim there, and a `shortcut` message is how the
 * press gets back. Every other press lands on this document as a `keydown` — a
 * Wayland window is an `<app>` element and DOM focus never leaves the page —
 * and the listener below is what answers it. The same claim is what keeps the
 * SDK from forwarding the chord to that window on its way past, which is what
 * makes it exactly one of the two paths for any press rather than both.
 *
 * Both paths read one table, and both read it *in the current mode*: `mod+r`
 * changes what the same keys do, and the compositor knows nothing about modes.
 */
export const useShortcuts = ({ domicile, mode, onAction }: Options) => {
  // Claimed once for the whole session, for every mode at once: a claim cannot
  // be given back, and a mode that grabbed its keys on the way in would be a
  // desktop that kept them for good.
  useEffect(() => {
    for (const chord of CHORDS) {
      domicile.grabShortcut(chord);
    }
  }, [domicile]);

  useEffect(() => {
    // `on` is a single slot and re-registering replaces it, so there is
    // nothing to tear down — which is also why this effect can depend on the
    // mode without the claim above being made again.
    domicile.on("shortcut", ({ keycode, shiftKey }) => {
      const action = actionForKeycode(mode, keycode, shiftKey);
      if (action !== undefined) {
        onAction(action);
      }
    });
  }, [domicile, mode, onAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Every modifier is part of the chord, the way the compositor's claim
      // is: Ctrl+Super+Return is a combination nobody claimed, and the page is
      // the only path that would otherwise answer it.
      if (event.metaKey && !event.altKey && !event.ctrlKey) {
        const action = actionForCode(mode, event.code, event.shiftKey);
        if (action !== undefined) {
          // Taken from the page whether or not it acts: the chord is the
          // desktop's for as long as it is held, and Tab would otherwise walk
          // the focus ring out from under the window being worked in.
          event.preventDefault();
          // A held key repeats tens of times a second and the compositor never
          // sees a repeat at all, so one press does one thing on either path.
          if (!event.repeat) {
            onAction(action);
          }
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mode, onAction]);
};
