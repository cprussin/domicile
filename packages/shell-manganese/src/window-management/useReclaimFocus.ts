import { useCallback, useEffect } from "react";

/**
 * Keep this document's focus on `element` while the window it belongs to is
 * the one being worked in, taking it back whenever nothing at all holds it.
 *
 * **Only from nothing.** The chrome around a window is full of things that
 * take the focus on purpose, and every one of them is the user reaching for
 * it: the address bar over the page, a tab in the rail, the theme switch. A
 * window that took the focus back from those is a window whose address bar
 * cannot be typed in, and a rail whose tabs cannot be walked with the
 * keyboard. What is taken back is the focus that landed on *nothing*.
 *
 * Which the chrome does every time a window closes: the control pressed to
 * close one takes the focus on the press and is unmounted before the press
 * ends, leaving the document's body focused and every keystroke after it
 * delivered nowhere.
 *
 * A window whose keyboard is a client's has no need of this — the seat is the
 * compositor's, it says where the keyboard went, and the window still selected
 * asks for it back; see `AppWindow`. A window whose keyboard *is* this
 * document's focus has nothing that says so, which is why the rule is checked
 * rather than announced.
 *
 * Both moments the chrome can drop it are watched, because they are different
 * moments: a press that lands on something unfocusable says so in a
 * `focusout`, and an element that is removed dispatches no focus event at all,
 * so the only sign of that one is the commit that removed it.
 *
 * `null` rather than `undefined` for the missing element because that is what
 * React's ref API hands a callback ref.
 */
export const useReclaimFocus = (
  element: HTMLElement | null,
  focused: boolean,
): void => {
  const reclaim = useCallback(() => {
    if (
      focused &&
      element !== null &&
      document.activeElement === document.body
    ) {
      element.focus();
    }
  }, [element, focused]);

  // No dependency array on purpose: the focus an unmounted element took with
  // it changes nothing this hook is given, so the render is the whole signal.
  useEffect(() => {
    reclaim();
  });

  useEffect(() => {
    const dropped = () => {
      // `focusout` runs before the focus lands, and where it lands is the whole
      // question — during it the body is focused whether or not anything is
      // about to be. So the answer is read once the press has finished moving
      // it.
      queueMicrotask(reclaim);
    };
    document.addEventListener("focusout", dropped);
    return () => {
      document.removeEventListener("focusout", dropped);
    };
  }, [reclaim]);
};
