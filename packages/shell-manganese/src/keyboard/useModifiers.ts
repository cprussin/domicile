import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { HostMessageOf } from "@domicile/chrome-sdk/host-message";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The modifiers the shell reacts to.
 *
 * Meta is the desktop's modifier — sway's `floating_modifier $mod` is the same
 * key as its bindings — and holding it hands the pointer to the shell, which
 * is what makes a drag catchable in the page at all; Shift makes that drag a
 * resize, as does taking hold with the secondary button.
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
 * — the Meta of the Meta+Return that spawned the terminal, before there was a
 * window to hold anything — never reaches the seat, and the next forwarded key
 * makes the compositor broadcast a set that denies it.
 *
 * This listened to that broadcast and took it over its own keystrokes, which
 * is a held Meta read as let go of: the grab sheet came down and the window the
 * user had just floated would not drag until they released Meta and pressed it
 * again, which is what put it into the seat. The host cannot know a key this
 * page did not tell it about, so there is nothing to ask it for. When input
 * comes off DRM rather than out of the browser — see
 * `/docs/architecture/A-DESKTOP-ON-A-TTY.md` — the compositor is the one that
 * knows and the `modifiers` message is how it will say so; it does not know
 * today.
 *
 * **Except while a browser window's page has the keyboard**, when this page
 * hears nothing at all: the page is a guest with a document of its own, and
 * its keys never reach this one. So Meta held over a focused browser window
 * was never held as far as the desktop knew, and the window would not drag.
 * The engine reads the guest's keys itself and sends what they hold as that
 * same `modifiers` message — and the compositor's copy says nothing then,
 * because this page forwards no keys to it to be short of. So the message is
 * taken exactly while a `<webview>` is where this document's focus is.
 *
 * **Held is not the same question as meant, and only for Shift.**
 * Meta+Shift+Tab floats a window and Shift over a floating one resizes it, so
 * the half-second after the chord — Meta still down because the shell needs it
 * to have the pointer, Shift not let go of yet — is a user reaching to move a
 * window with the keys for resizing it already held.
 * {@link HeldModifiers.spendShift} is what the chord says so with.
 */
export const useModifiers = (domicile: DomicileClient): HeldModifiers => {
  const [held, setHeld] = useState(NOTHING_HELD);

  // The same object when nothing moved, so a page that holds Meta through a
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
      settle({ meta: metaHeld(event), shift: event.shiftKey });
    };
    document.addEventListener("keydown", follow);
    document.addEventListener("keyup", follow);
    return () => {
      document.removeEventListener("keydown", follow);
      document.removeEventListener("keyup", follow);
    };
  }, [settle]);

  useEffect(() => {
    const reported = (held: HostMessageOf<"modifiers">) => {
      if (guestHasKeyboard()) {
        settle({ meta: held.metaKey, shift: held.shiftKey });
      }
    };
    domicile.on("modifiers", reported);
    return () => {
      domicile.off("modifiers", reported);
    };
  }, [domicile, settle]);

  return useMemo(
    () => ({
      modifiers: { ...held.down, shift: held.down.shift && !held.spent },
      spendShift,
    }),
    [held, spendShift],
  );
};

/**
 * Whether Meta is down once this event has happened.
 *
 * Off the event's type when Meta is the key that moved, because Chromium on
 * Wayland reports the release of Meta with `metaKey` still set — the state
 * from before the key came up. Read off the flag, a nested desktop never lets
 * go of Meta, and every floating window keeps its grab sheet over it for good.
 */
const metaHeld = (event: KeyboardEvent): boolean =>
  event.key === "Meta" ? event.type === "keydown" : event.metaKey;

/** Whether these are the same keys down, which is all a re-render turns on. */
const same = (held: Modifiers, next: Modifiers): boolean =>
  held.meta === next.meta && held.shift === next.shift;

/**
 * Whether a browser window's page has the keyboard: its `<webview>` is this
 * document's `activeElement` while the guest inside it is focused — see
 * `BrowserWindow`.
 */
const guestHasKeyboard = (): boolean =>
  document.activeElement?.localName === "webview";
