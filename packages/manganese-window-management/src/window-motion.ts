// The animation state of a window: arriving, leaving or resting.
//
// A string union because the values are Panda `cva` variant keys and are also
// written to `data-motion`, which devtools and tests can read.
//
// A newly opened window grows from its frame's center, and a new tab opens
// along its strip. A window carried in by a workspace switch slides in from the
// side that workspace is on, so a switch does not look like many windows
// opening.

/**
 * The direction of a workspace switch, in logical terms: `end` is the
 * direction of increasing workspace numbers.
 */
export type Towards = "end" | "start";

export type WindowMotion =
  | "arriving-from-end"
  | "arriving-from-start"
  | "closing"
  | "closing-tab"
  | "dropping"
  | "leaving-to-end"
  | "leaving-to-start"
  | "opening"
  | "opening-tab"
  | Shuffle
  | "resting"
  | Reversal
  | "sending"
  | "sending-tab"
  | "stowing"
  | TabFade;

/**
 * A workspace switch played backwards, when switched back before it ends.
 *
 * - `retreating-*`: a window that was arriving goes back the way it came.
 * - `returning-*`: a window that was leaving comes back.
 *
 * Each plays the motion it cuts short in reverse, starting as far in as that
 * one had left (`DrawnWindow.rewound`), so every window starts where it is.
 */
export type Reversal =
  | "retreating-to-end"
  | "retreating-to-start"
  | "returning-from-end"
  | "returning-from-start";

/**
 * A tab being shown or hidden. See `tab-switch.ts`.
 *
 * - `concealing` and `revealing`: the two halves of a tab switch crossfade,
 *   where the revealed window fades in over the hidden one.
 * - `uncovering`: the window shown when the tab over it closes. It holds its
 *   depth so no other hidden tab shows through the closing one.
 */
export type TabFade = "concealing" | "revealing" | "uncovering";

/**
 * A float swapping places in the stack. Two identical animations let the same
 * move restart; see `nextShuffle`.
 */
export type Shuffle = "restacking" | "restacking-again";

/**
 * The motion of a window on the workspace being switched to, or `reversed`
 * when the switch turns back one still playing. See {@link Reversal}.
 */
export const arrivalFrom = (
  towards: Towards,
  reversed: boolean,
): WindowMotion => {
  if (towards === "end") {
    return reversed ? "returning-from-end" : "arriving-from-end";
  } else {
    return reversed ? "returning-from-start" : "arriving-from-start";
  }
};

/**
 * The motion of a window on the workspace being switched from. It leaves the
 * opposite way, so the two workspaces pass each other.
 */
export const departureFor = (
  towards: Towards,
  reversed: boolean,
): WindowMotion => {
  if (towards === "end") {
    return reversed ? "retreating-to-start" : "leaving-to-start";
  } else {
    return reversed ? "retreating-to-end" : "leaving-to-end";
  }
};

/**
 * Whether the window is leaving the screen.
 *
 * A leaving window keeps its box and contents and ignores input, since focus
 * has moved on.
 */
export const isLeaving = (motion: WindowMotion): boolean => {
  switch (motion) {
    case "closing":
    case "closing-tab":
    case "leaving-to-end":
    case "leaving-to-start":
    case "retreating-to-end":
    case "retreating-to-start":
    case "sending":
    case "sending-tab":
    case "stowing": {
      return true;
    }
    case "arriving-from-end":
    case "arriving-from-start":
    case "concealing":
    case "dropping":
    case "opening":
    case "opening-tab":
    case "restacking":
    case "restacking-again":
    case "resting":
    case "returning-from-end":
    case "returning-from-start":
    case "revealing":
    case "uncovering": {
      return false;
    }
  }
};

/** Whether a workspace switch is sliding the window on or off its screen. */
export const isSwitching = (motion: WindowMotion): boolean => {
  switch (motion) {
    case "arriving-from-end":
    case "arriving-from-start":
    case "leaving-to-end":
    case "leaving-to-start":
    case "retreating-to-end":
    case "retreating-to-start":
    case "returning-from-end":
    case "returning-from-start": {
      return true;
    }
    case "closing":
    case "closing-tab":
    case "concealing":
    case "dropping":
    case "opening":
    case "opening-tab":
    case "restacking":
    case "restacking-again":
    case "resting":
    case "revealing":
    case "sending":
    case "sending-tab":
    case "stowing":
    case "uncovering": {
      return false;
    }
  }
};

/**
 * Whether the window is sliding onto its screen from where it was not drawn:
 * a workspace switch or the scratchpad bringing it in.
 *
 * Its client or page draws again as it comes in, and a heavy page takes
 * frames to. The engine would hold the desk for it (`resizing`).
 */
export const isSlidingIn = (motion: WindowMotion): boolean => {
  switch (motion) {
    case "arriving-from-end":
    case "arriving-from-start":
    case "dropping":
    case "returning-from-end":
    case "returning-from-start": {
      return true;
    }
    case "closing":
    case "closing-tab":
    case "concealing":
    case "leaving-to-end":
    case "leaving-to-start":
    case "opening":
    case "opening-tab":
    case "restacking":
    case "restacking-again":
    case "resting":
    case "retreating-to-end":
    case "retreating-to-start":
    case "revealing":
    case "sending":
    case "sending-tab":
    case "stowing":
    case "uncovering": {
      return false;
    }
  }
};

/** Whether the scratchpad is sliding the window down onto or up off its screen. */
export const isScratchpadSlide = (motion: WindowMotion): boolean => {
  switch (motion) {
    case "dropping":
    case "stowing": {
      return true;
    }
    case "arriving-from-end":
    case "arriving-from-start":
    case "closing":
    case "closing-tab":
    case "concealing":
    case "leaving-to-end":
    case "leaving-to-start":
    case "opening":
    case "opening-tab":
    case "restacking":
    case "restacking-again":
    case "resting":
    case "retreating-to-end":
    case "retreating-to-start":
    case "returning-from-end":
    case "returning-from-start":
    case "revealing":
    case "sending":
    case "sending-tab":
    case "uncovering": {
      return false;
    }
  }
};

/**
 * The motion of a window's title bar.
 *
 * A tab switch only animates contents: in a tabbed container the bar is the
 * tab, which stays on screen.
 */
export const barMotion = (motion: WindowMotion): WindowMotion => {
  switch (motion) {
    case "concealing":
    case "revealing":
    case "uncovering": {
      return "resting";
    }
    case "arriving-from-end":
    case "arriving-from-start":
    case "closing":
    case "closing-tab":
    case "dropping":
    case "leaving-to-end":
    case "leaving-to-start":
    case "opening":
    case "opening-tab":
    case "restacking":
    case "restacking-again":
    case "resting":
    case "retreating-to-end":
    case "retreating-to-start":
    case "returning-from-end":
    case "returning-from-start":
    case "sending":
    case "sending-tab":
    case "stowing": {
      return motion;
    }
  }
};

/** Whether `motion` moves or scales the window, rather than only fading it. */
export const isMoving = (motion: WindowMotion): boolean =>
  barMotion(motion) !== "resting";
