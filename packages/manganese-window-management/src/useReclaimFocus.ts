import { useCallback, useEffect } from "react";

/** The attributes that take focus from an element without an event. */
const DROPS_FOCUS = ["disabled", "hidden", "inert"];

/**
 * Keeps document focus on `element` while its window is selected, calling
 * `take` when focus lands on nothing.
 *
 * `take` exists because a browser window must know which focus events it caused
 * (see `BrowserWindow`).
 *
 * Only focus on nothing is reclaimed, so chrome controls such as the address
 * bar can still take focus. Focus lands on nothing when a pressed control is
 * unmounted (for example, a close button) or made inert (the lock screen),
 * which fires no event, so the hook watches the page for such changes. They
 * can happen anywhere on the page, without this window redrawing. It also
 * listens for `focusout`, which fires when a press lands on an unfocusable
 * element.
 *
 * App windows do not need this: the compositor tracks their keyboard focus (see
 * `AppWindow`).
 *
 * Takes `null` because the element comes from a callback ref.
 */
export const useReclaimFocus = <Element extends HTMLElement>(
  element: Element | null,
  focused: boolean,
  take: (element: Element) => void,
): void => {
  const reclaim = useCallback(() => {
    if (
      focused &&
      element !== null &&
      document.activeElement === document.body
    ) {
      take(element);
    }
  }, [element, focused, take]);

  useEffect(() => {
    reclaim();
  }, [reclaim]);

  // Only the selected window listens, since every window has this hook.
  useEffect(() => {
    if (focused) {
      const dropped = (event: FocusEvent) => {
        // Check `relatedTarget`, not `document.activeElement`. During
        // `focusout`, and in microtasks queued from it, the active element is
        // `body` even when focus is moving to another element. Reclaiming then
        // steals focus from the address bar, and Blink treats that as refusing
        // the focus change. `null` means focus is landing on nothing. The
        // microtask lets the press finish before reclaiming.
        if (event.relatedTarget === null) {
          queueMicrotask(reclaim);
        }
      };
      // After the change's task, not in a microtask, which could land
      // mid-move as described above.
      let pending: ReturnType<typeof setTimeout> | undefined;
      const changed = new MutationObserver(() => {
        clearTimeout(pending);
        pending = setTimeout(reclaim, 0);
      });
      changed.observe(document.documentElement, {
        attributeFilter: DROPS_FOCUS,
        childList: true,
        subtree: true,
      });
      document.addEventListener("focusout", dropped);
      return () => {
        document.removeEventListener("focusout", dropped);
        changed.disconnect();
        clearTimeout(pending);
      };
    } else {
      return undefined;
    }
  }, [focused, reclaim]);
};
