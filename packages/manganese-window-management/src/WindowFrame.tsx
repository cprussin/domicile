import type { ReactNode } from "react";

import type { Spot } from "./pointer-warp";
import type { Rect } from "./rect";
import type { WindowMotion } from "./window-motion";
import { clippedTo, screenClipStyles, slidAcross } from "./window-styles";

type Props = {
  /** The window's contents or its bar. */
  children: ReactNode;
  /** The window's frame, which the scratchpad slides lift. */
  frame: Rect | undefined;
  /** The window's motion; a workspace switch clips it to its screen. */
  motion: WindowMotion;
  /**
   * Called when the pointer enters any part of this window, with the page
   * position. Focus follows the cursor; `usePointerWarp` uses the position to
   * tell a real pointer move from a window appearing under a still pointer.
   */
  onHover: (at: Spot) => void;
  /**
   * Called on every press in this window, even when it is already active:
   * focus follows the cursor, but only a press raises the window.
   */
  onReach: () => void;
  /** How far into its motion the window starts. See `slidAcross`. */
  rewound: number;
  /** Its screen, which the window's slides move it off. See `slidAcross`. */
  screen: Rect | undefined;
};

/**
 * Marks window frames, so document listeners can tell a window from the bare
 * desk. See `useScreenFollowsPointer`.
 */
export const WINDOW_FRAME = "data-window-frame";

/**
 * Wraps a window's bar and contents to handle pointer hover and press for
 * every kind of window in one place.
 *
 * Takes no space, stacking or pointer of its own (see `screenClipStyles`).
 * Its children inherit the slide distances from it, and it clips them to
 * their screen during a workspace switch.
 */
export const WindowFrame = ({
  children,
  frame,
  motion,
  onHover,
  onReach,
  rewound,
  screen,
}: Props) => (
  <div
    className={screenClipStyles}
    {...{ [WINDOW_FRAME]: "" }}
    onPointerDown={onReach}
    // `pointerover` bubbles from whichever part the pointer entered.
    onPointerOver={(event) => {
      onHover([event.clientX, event.clientY]);
    }}
    style={
      screen === undefined
        ? undefined
        : {
            ...slidAcross(screen, frame, motion, rewound),
            ...clippedTo(screen, motion),
          }
    }
  >
    {children}
  </div>
);
