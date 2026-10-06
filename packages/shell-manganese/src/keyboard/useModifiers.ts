import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The modifiers the shell reacts to.
 *
 * Holding Meta gives the pointer to the shell so it can drag windows, like
 * sway's `floating_modifier`. Shift turns the drag into a resize.
 */
export type Modifiers = {
  meta: boolean;
  shift: boolean;
};

/** No modifiers held. */
const NONE: Modifiers = { meta: false, shift: false };

/**
 * Held modifiers, and whether their Shift is spent.
 *
 * One state value so `spent` always refers to the Shift in `down`.
 */
type Held = {
  down: Modifiers;
  /**
   * Whether the Shift in `down` was part of a chord the desktop handled.
   *
   * Cleared on Shift release: the user pressed it for the chord, not to
   * resize, so it doesn't count until pressed again.
   */
  spent: boolean;
};

/** Initial state. */
const NOTHING_HELD: Held = { down: NONE, spent: false };

type HeldModifiers = {
  modifiers: Modifiers;
  /** Mark the held Shift as used by a chord the desktop handled. */
  spendShift: () => void;
};

/**
 * The modifiers the shell should act on, read from this page's own key events.
 *
 * - The compositor only sees keys the SDK forwards while a client has the
 *   keyboard, so its modifier attributes miss keys pressed while the shell had
 *   focus. This page's events are the source of truth (see
 *   docs/architecture/A-DESKTOP-ON-A-TTY.md for input from DRM).
 * - While a browser window's `<webview>` has focus, this page gets no key
 *   events. The engine then reports the guest's modifiers with
 *   `modifierschanged`, which this uses only in that case.
 * - After Meta+Shift+Tab floats a window, the still-held Shift would start a
 *   resize. The chord calls {@link HeldModifiers.spendShift} to ignore it until
 *   it is pressed again.
 */
export const useModifiers = (domicile: DomicileHost): HeldModifiers => {
  const [held, setHeld] = useState(NOTHING_HELD);

  // Keep the same object when nothing changed, to avoid a re-render per
  // keystroke.
  const settle = useCallback((next: Modifiers) => {
    setHeld((last) =>
      same(last.down, next)
        ? last
        : { down: next, spent: last.spent && next.shift },
    );
  }, []);

  // Spend only a Shift this page saw held. A chord can arrive from a window
  // whose keys this page doesn't see; marking Shift spent then would swallow
  // the next press.
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

  // This page misses key releases while it lacks the keyboard (e.g. a nested
  // desktop whose host took focus), which would leave Meta stuck. So blur
  // releases everything, and pointer events, which carry modifier state,
  // correct it. Capture phase, so nothing under the pointer can stop them.
  useEffect(() => {
    const released = () => {
      settle(NONE);
    };
    const pointed = (event: PointerEvent) => {
      settle({ meta: event.metaKey, shift: event.shiftKey });
    };
    window.addEventListener("blur", released);
    document.addEventListener("pointermove", pointed, { capture: true });
    document.addEventListener("pointerdown", pointed, { capture: true });
    return () => {
      window.removeEventListener("blur", released);
      document.removeEventListener("pointermove", pointed, { capture: true });
      document.removeEventListener("pointerdown", pointed, { capture: true });
    };
  }, [settle]);

  useEffect(() => {
    const reported = () => {
      if (guestHasKeyboard()) {
        settle({
          meta: domicile.metaKey === true,
          shift: domicile.shiftKey === true,
        });
      }
    };
    domicile.addEventListener("modifierschanged", reported);
    return () => {
      domicile.removeEventListener("modifierschanged", reported);
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
 * Whether Meta is down after this event.
 *
 * Uses the event type when Meta itself changed, because Chromium on Wayland
 * reports a Meta release with `metaKey` still set.
 */
const metaHeld = (event: KeyboardEvent): boolean =>
  event.key === "Meta" ? event.type === "keydown" : event.metaKey;

/** Whether two modifier states are equal. */
const same = (held: Modifiers, next: Modifiers): boolean =>
  held.meta === next.meta && held.shift === next.shift;

/**
 * Whether a browser window's page has the keyboard, i.e. its `<webview>` is
 * the `activeElement` (see `BrowserWindow`).
 */
const guestHasKeyboard = (): boolean =>
  document.activeElement?.localName === "webview";
