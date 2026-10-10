import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import type { Spot } from "./pointer-warp";
import type { Rect } from "./rect";
import { slidAcross } from "./window-styles";

type Props = {
  /** The window's contents or its bar. */
  children: ReactNode;
  /** The window's frame, which the scratchpad slides lift. */
  frame: Rect | undefined;
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
 * Uses `display: contents`, so it has no box and does not affect layout,
 * stacking or hit-testing. Its children inherit the slide distances from it.
 */
export const WindowFrame = ({
  children,
  frame,
  onHover,
  onReach,
  rewound,
  screen,
}: Props) => (
  <div
    className={frameStyles}
    {...{ [WINDOW_FRAME]: "" }}
    onPointerDown={onReach}
    // `pointerover` bubbles from whichever part the pointer entered.
    onPointerOver={(event) => {
      onHover([event.clientX, event.clientY]);
    }}
    style={
      screen === undefined ? undefined : slidAcross(screen, frame, rewound)
    }
  >
    {children}
  </div>
);

const frameStyles = css({ display: "contents" });
