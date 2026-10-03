import type { Display } from "@domicile-desktop/component-library/display-source";
import { useEffect } from "react";
import { WINDOW_FRAME } from "../window-management/WindowFrame";
import { WindowAction } from "../window-management/window-state";
import { screenUnder } from "./screen-under";

type Options = {
  act: (action: WindowAction) => void;
  /** The desk the host described, or `undefined` before it has. */
  displays: readonly Display[] | undefined;
  /** The screen the keyboard is on. */
  focused: string;
};

/**
 * Put the keyboard on the screen the pointer moves on — sway's
 * `focus_follows_mouse` from one output to the next.
 *
 * **A SCREEN, NOT A WINDOW.** Crossing into a window already moves the
 * keyboard to its screen, but a monitor with nothing on it has no window to
 * cross into, and the pointer could arrive there and leave the keyboard — and
 * so the next window to open — on the monitor it came from.
 *
 * **NOT OVER A WINDOW**, wherever the window's box spills: a float dragged
 * half onto the next monitor is still the float, and the screen under that
 * half answering would hand the keyboard to whatever that screen has focused
 * — the window under the float — on every move, with no new `pointerover` to
 * take it back. A window is the window's to answer.
 *
 * Asked only when the keyboard is somewhere else: every move of the hand is a
 * `pointermove`.
 */
export const useScreenFollowsPointer = ({
  act,
  displays,
  focused,
}: Options): void => {
  useEffect(() => {
    const moved = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(`[${WINDOW_FRAME}]`) !== null
      ) {
        return;
      }
      const name = screenUnder(displays ?? [], [event.clientX, event.clientY]);
      if (name !== undefined && name !== focused) {
        act(WindowAction.ScreenHovered(name));
      }
    };
    // On the document, like `usePointerWarp`'s: a pointer over a window is
    // this page's pointer on its way to the client under it.
    document.addEventListener("pointermove", moved);
    return () => {
      document.removeEventListener("pointermove", moved);
    };
  }, [act, displays, focused]);
};
