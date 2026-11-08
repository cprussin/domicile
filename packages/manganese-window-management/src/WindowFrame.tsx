import { PopupBoundary } from "@domicile-desktop/component-library/PopupBoundary";
import type { ReactNode } from "react";

import { cx } from "../styled-system/css";
import { seenAt, seenStyles } from "./overview/seen-styles";
import type { Seen } from "./overview/sight";
import type { Spot } from "./pointer-warp";
import type { Rect } from "./rect";
import type { WindowMotion } from "./window-motion";
import { clippedTo, screenClipStyles, slidAcross } from "./window-styles";

type Props = {
  /** The window's contents or its bar. */
  children: ReactNode;
  /** The depth of the contents or bar it holds. */
  depth: number;
  /**
   * The window's frame, which the scratchpad slides lift and popups opened in
   * the window stay inside.
   */
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
  /** How the overview shows it, if open. See `seenAt`. */
  seen: Seen | undefined;
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
 * Keeps popups opened in the window inside its frame, so they never cover
 * the windows beside it.
 *
 * Takes no space, stacking or pointer of its own (see `screenClipStyles`).
 * Its children inherit the slide distances from it, and it clips them to
 * their screen during a workspace switch. In the overview, it shows them
 * through their workspace's tile.
 */
export const WindowFrame = ({
  children,
  depth,
  frame,
  motion,
  onHover,
  onReach,
  rewound,
  screen,
  seen,
}: Props) => (
  <div
    className={cx(
      screenClipStyles,
      seenStyles({
        fading: seen?.fading ?? false,
        showing: seen?.showing ?? false,
      }),
    )}
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
            ...seenAt(seen, screen, depth),
          }
    }
  >
    <PopupBoundary box={frame}>{children}</PopupBoundary>
  </div>
);
