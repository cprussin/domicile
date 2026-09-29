import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import type { Spot } from "./pointer-warp";

type Props = {
  /** The window's parts: its contents and, while it is on screen, its bar. */
  children: ReactNode;
  /**
   * Called when the pointer crosses into any part of this window, with the
   * place on the page it crossed at.
   *
   * Focus follows the cursor in this shell, so arriving over a window is the
   * user starting to work in it — where the pointer is what did the arriving,
   * which is what the place is for: see `usePointerWarp`.
   */
  onHover: (at: Spot) => void;
  /**
   * Called when the user presses any part of this window.
   *
   * Every press, including one in the window the user is already in: focus
   * follows the cursor, so the pointer has already made this the active
   * window, and a press is still what raises it.
   */
  onReach: () => void;
};

/**
 * One window, whatever is in it: the element its bar and its contents share,
 * which hears the pointer for both.
 *
 * **One place for every part, so every kind of window is worked the same.** An
 * `<app>`, a `<webview>`, the chrome around one and the bar over either are
 * all elements of this page, so the pointer arriving over any of them, or a
 * press on one, comes up the document through here. What is left to each kind
 * is only what this cannot hear: the SDK's request for a client's keyboard,
 * and the focus a guest page takes, which never leaves it.
 *
 * **It draws nothing.** `display: contents` gives it no box, so each part is
 * placed, stacked and hit-tested exactly as it would be without it — this is
 * a node in the document for events to pass through, not a layer.
 */
export const WindowFrame = ({ children, onHover, onReach }: Props) => (
  <div
    className={frameStyles}
    onPointerDown={onReach}
    // `pointerover` rather than `pointerenter`: the one that bubbles from the
    // part it crossed into, which is where the place comes from.
    onPointerOver={(event) => {
      onHover([event.clientX, event.clientY]);
    }}
  >
    {children}
  </div>
);

const frameStyles = css({ display: "contents" });
