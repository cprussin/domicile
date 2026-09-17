import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The modifiers the shell reacts to.
 *
 * Super is the desktop's modifier — sway's `floating_modifier $mod` — and
 * holding it hands the pointer to the shell, which is what makes a drag
 * catchable in the page at all; Shift makes that drag a resize, as does taking
 * hold with the secondary button.
 */
export type Modifiers = {
  meta: boolean;
  shift: boolean;
};

/** Nothing held, which is what the shell assumes until it is told otherwise. */
const NONE: Modifiers = { meta: false, shift: false };

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
 * Which modifiers the shell should act on, off this page's own keyboard.
 *
 * **The page is the only thing that hears this keyboard, and the compositor's
 * answer is this page's own keystrokes handed back short.** The desktop is the
 * chrome's window: every key the compositor's seat has ever seen arrived as a
 * `key` the SDK forwarded from this document, and the SDK forwards only while
 * a client holds the keyboard. So a modifier pressed while the chrome holds it
 * — the Super of the Super+Return that spawned the terminal, before there was
 * a window to hold anything — never reaches the seat, and the next forwarded key
 * makes the compositor broadcast a set that denies it.
 *
 * This listened to that broadcast and took it over its own keystrokes, which
 * is a held Super read as let go of: the grab sheet came down and the window the
 * user had just floated would not drag until they released Super and pressed it
 * again, which is what put it into the seat. The host cannot know a key this
 * page did not tell it about, so there is nothing to ask it for. When input
 * comes off DRM rather than out of the browser — see
 * `/docs/architecture/A-DESKTOP-ON-A-TTY.md` — the compositor is the one that
 * knows and the `modifiers` message is how it will say so; it does not know
 * today.
 *
 * **Held is not the same question as meant, and only for Shift.**
 * Super+Shift+Tab floats a window and Shift over a floating one resizes it, so
 * the half-second after the chord — Super still down because the shell needs it
 * to have the pointer, Shift not let go of yet — is a user reaching to move a
 * window with the keys for resizing it already held.
 * {@link HeldModifiers.spendShift} is what the chord says so with.
 */
export const useModifiers = (): HeldModifiers => {
  const [held, setHeld] = useState(NOTHING_HELD);

  // The same object when nothing moved, so a page that holds Super through a
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
    const follow = (event: KeyboardEvent) => {
      settle({ meta: event.metaKey, shift: event.shiftKey });
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
  held.meta === next.meta && held.shift === next.shift;
