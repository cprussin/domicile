import type { Display } from "@domicile-desktop/component-library/display-source";
import { useEffect } from "react";
import { WINDOW_FRAME } from "../window-management/WindowFrame";
import { WindowAction } from "../window-management/window-state";
import { screenUnder } from "./screen-under";

type Options = {
  act: (action: WindowAction) => void;
  /** The host's desktop, or `undefined` before it is described. */
  displays: readonly Display[] | undefined;
  /** The screen with keyboard focus. */
  focused: string;
};

/**
 * Move keyboard focus to the screen under the pointer, like sway's
 * `focus_follows_mouse` across outputs.
 *
 * Needed for screens: entering a window already focuses its screen, but an
 * empty monitor has no window to enter, so the next window would open on the
 * old one.
 *
 * Ignored over windows, even where a window spills onto another screen.
 * Otherwise a float dragged half across would hand focus to the window under it
 * on every move.
 *
 * Only acts when focus is on another screen, since this runs on every
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
    // On the document, like `usePointerWarp`: a pointer over a window is still
    // this page's pointer.
    document.addEventListener("pointermove", moved);
    return () => {
      document.removeEventListener("pointermove", moved);
    };
  }, [act, displays, focused]);
};
