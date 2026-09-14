import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useCallback, useEffect, useMemo, useState } from "react";

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
 * What the keyboard has down, and whether the desktop has already spent it.
 *
 * One slot rather than two, because spending is a question about the Shift in
 * `down` and answering it from another slot would be answering it about
 * whichever Shift that slot had last.
 */
type Held = {
  down: Modifiers;
  /**
   * Whether the Shift in `down` was part of a chord the desktop has answered.
   *
   * Cleared by letting go of Shift, which is the whole of what it means: the
   * user pressed Shift to float a window, not to resize one, so it is not a
   * request to resize until it is pressed again.
   */
  spent: boolean;
};

/** Nothing down and nothing spent: where the shell starts. */
const NOTHING_HELD: Held = { down: NONE, spent: false };

type HeldModifiers = {
  modifiers: Modifiers;
  /**
   * The desktop answered a chord, so the Shift it was pressed with stops
   * counting as one the user is holding over a window.
   */
  spendShift: () => void;
};

/**
 * Which modifiers the shell should act on, from both of the places that can
 * know which are held.
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
 *
 * **Held is not the same question as meant, and only for Shift.** Alt+Shift+Tab
 * floats a window and Shift over a floating one resizes it, so the half-second
 * after the chord — Alt still down because the shell needs it to have the
 * pointer, Shift not let go of yet — is a user reaching to move a window with
 * the keys for resizing it already held. {@link HeldModifiers.spendShift} is
 * what the chord says so with.
 */
export const useModifiers = (domicile: DomicileClient): HeldModifiers => {
  const [held, setHeld] = useState(NOTHING_HELD);

  // The same object when nothing moved, so a page that holds Alt through a
  // sentence of typing re-renders once rather than per keystroke.
  const settle = useCallback((next: Modifiers) => {
    setHeld((last) =>
      same(last.down, next)
        ? last
        : { down: next, spent: last.spent && next.shift },
    );
  }, []);

  // Whether there is anything to spend is read here rather than at the call
  // site: a chord the shell answered without having heard its Shift — the
  // compositor hands one back from a window the page hears no keys from — has
  // no held Shift to take, and marking one spent would swallow the next press.
  const spendShift = useCallback(() => {
    setHeld((last) => ({ ...last, spent: last.down.shift }));
  }, []);

  useEffect(() => {
    // `on` returns the client for chaining, so it is deliberately not returned
    // as a cleanup — there is one handler per message type and re-registering
    // replaces it.
    // The compositor's names for these are the web's now, so the two halves
    // below read the same: `altKey` off a `modifiers` message is the same fact
    // as `altKey` off a `KeyboardEvent`.
    domicile.on("modifiers", ({ altKey, ctrlKey, shiftKey }) => {
      settle({ alt: altKey, ctrl: ctrlKey, shift: shiftKey });
    });
  }, [domicile, settle]);

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

  return useMemo(
    () => ({
      modifiers: { ...held.down, shift: held.down.shift && !held.spent },
      spendShift,
    }),
    [held, spendShift],
  );
};

/** Whether these are the same keys down, which is all a re-render turns on. */
const same = (held: Modifiers, next: Modifiers): boolean =>
  held.alt === next.alt && held.ctrl === next.ctrl && held.shift === next.shift;
