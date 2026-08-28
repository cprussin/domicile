import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { useCallback, useEffect, useState } from "react";

/**
 * The modifiers the shell reacts to.
 *
 * Alt and Ctrl both hand the pointer to the shell, which is what makes a drag
 * catchable in the page at all; Shift makes that drag a resize, as does taking
 * hold with the secondary button.
 */
export type Modifiers = {
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
};

/** Nothing held, which is what the shell assumes until it is told otherwise. */
const NONE: Modifiers = { alt: false, ctrl: false, shift: false };

/**
 * Which modifiers are held, from both of the places that can know.
 *
 * The host is the one that matters. `wl_keyboard.modifiers` goes to whatever
 * holds the keyboard, so once a window is focused the page hears nothing about
 * the Alt the user is holding — which is exactly when the shell needs to know,
 * because that is when they are reaching for it to drag a window. So the
 * compositor broadcasts the set whenever it changes, and this listens.
 *
 * The page's own keyboard events are the other half, and they are what makes
 * the shell work in a plain browser with no host to ask — which is how it is
 * opened for styling work. The two cannot disagree: whichever of them is
 * hearing this keyboard is the only one delivering, and both describe the same
 * keys.
 */
export const useModifiers = (bridge: BridgeClient): Modifiers => {
  const [held, setHeld] = useState(NONE);

  // The same object when nothing moved, so a page that holds Alt through a
  // sentence of typing re-renders once rather than per keystroke.
  const settle = useCallback((next: Modifiers) => {
    setHeld((last) =>
      last.alt === next.alt &&
      last.ctrl === next.ctrl &&
      last.shift === next.shift
        ? last
        : next,
    );
  }, []);

  useEffect(() => {
    // `on` returns the bridge for chaining, so it is deliberately not returned
    // as a cleanup — there is one handler per message type and re-registering
    // replaces it.
    bridge.on("modifiers", ({ alt, ctrl, shift }) => {
      settle({ alt, ctrl, shift });
    });
  }, [bridge, settle]);

  useEffect(() => {
    const follow = (event: KeyboardEvent) => {
      settle({
        alt: event.altKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
      });
    };
    document.addEventListener("keydown", follow);
    document.addEventListener("keyup", follow);
    return () => {
      document.removeEventListener("keydown", follow);
      document.removeEventListener("keyup", follow);
    };
  }, [settle]);

  return held;
};
