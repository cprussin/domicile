// The animation state of a window: arriving, leaving or resting.
//
// A string union because the values are Panda `cva` variant keys and are also
// written to `data-motion`, which devtools and tests can read.
//
// A newly opened window grows from its frame's center. A window carried in by a
// workspace switch slides in from the side that workspace is on, so a switch
// does not look like many windows opening.

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
  | "leaving-to-end"
  | "leaving-to-start"
  | "opening"
  | Shuffle
  | "resting"
  | TabFade;

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

/** The motion of a window on the workspace being switched to. */
export const arrivalFrom = (towards: Towards): WindowMotion =>
  towards === "end" ? "arriving-from-end" : "arriving-from-start";

/**
 * The motion of a window on the workspace being switched from. It leaves the
 * opposite way, so the two workspaces pass each other.
 */
export const departureFor = (towards: Towards): WindowMotion =>
  towards === "end" ? "leaving-to-start" : "leaving-to-end";

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
    case "leaving-to-start": {
      return true;
    }
    case "arriving-from-end":
    case "arriving-from-start":
    case "concealing":
    case "opening":
    case "restacking":
    case "restacking-again":
    case "resting":
    case "revealing":
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
    case "leaving-to-end":
    case "leaving-to-start":
    case "opening":
    case "restacking":
    case "restacking-again":
    case "resting": {
      return motion;
    }
  }
};
