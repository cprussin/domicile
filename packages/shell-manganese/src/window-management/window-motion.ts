// What a window is doing that the page has to draw over time: arriving,
// leaving, or nothing at all.
//
// A string union rather than an enum, for the reason `title-focus.ts` is one:
// these are the keys of a Panda `cva` variant, and the shell writes the answer
// onto the element as `data-motion` as well — the desktop's own state is worth
// being able to read in devtools and in a test rather than only off a hashed
// class name.
//
// **A window arrives for one of two reasons and they do not look alike.** One
// that has just opened grows out of the middle of its own frame, because that
// is where it came from. One carried on by a workspace switch slides in from
// the side the workspace came from, because it was already there — it was on
// the desktop a moment ago and somewhere else is what it was. Drawing the
// second like the first is what makes every workspace switch look like ten
// windows opening at once.

/**
 * Which way the desktop went when the workspace on screen changed.
 *
 * The page's own logical directions rather than left and right: `end` is the
 * way the workspaces are numbered.
 */
export type Towards = "end" | "start";

export type WindowMotion =
  | "arriving-from-end"
  | "arriving-from-start"
  | "closing"
  | "leaving-to-end"
  | "leaving-to-start"
  | "opening"
  | "resting";

/** How a window of the workspace being switched to comes on screen. */
export const arrivalFrom = (towards: Towards): WindowMotion =>
  towards === "end" ? "arriving-from-end" : "arriving-from-start";

/**
 * And how one of the workspace being switched away from goes: the other way,
 * so the two workspaces pass each other rather than piling up on one side.
 */
export const departureFor = (towards: Towards): WindowMotion =>
  towards === "end" ? "leaving-to-start" : "leaving-to-end";

/**
 * Whether a window doing this is on its way off the screen.
 *
 * What such a window is owed is that nothing about it changes while it goes:
 * it is drawn at the box it had, saying what it said, and it asks for nothing
 * and answers nothing — the keyboard has moved on, and a window the user can
 * still reach is one they can reach for a fifth of a second and then not.
 */
export const isLeaving = (motion: WindowMotion): boolean => {
  switch (motion) {
    case "closing":
    case "leaving-to-end":
    case "leaving-to-start": {
      return true;
    }
    case "arriving-from-end":
    case "arriving-from-start":
    case "opening":
    case "resting": {
      return false;
    }
  }
};
