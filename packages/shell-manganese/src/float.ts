// A window that has left the tab rail: where it sits on the stage, and how big.
//
// Its own module rather than a field on `ShellWindow` because floating is not
// a kind of window — any window can be floated and put back, and a client's
// portal is the same portal either way. What changes is where the shell lays
// it out, which is exactly what this describes.

/** Where a floating window sits, in the stage's own pixels. */
export type Float = {
  height: number;
  /** The window this is the box of. */
  id: string;
  width: number;
  x: number;
  y: number;
};

/** How big a window is when it first leaves the rail. */
const OPENS_AT = { height: 420, width: 640 };

/**
 * How far each float is offset from the one before it.
 *
 * A cascade rather than a stack: a window that opened exactly on top of the
 * last one looks like the last one moved, and there is nothing to grab to find
 * out otherwise.
 */
const CASCADE = 36;

/** Where the first float sits. */
const ORIGIN = 48;

/**
 * A box for a window leaving the rail, cascaded past the `floating` boxes
 * already out there.
 *
 * The count rather than the last box's corner: dragging a window into the
 * corner must not put the next one off the stage, and the count is what says
 * how many are already out regardless of where the user has since put them.
 */
export const floatFor = (id: string, floating: number): Float => ({
  ...OPENS_AT,
  id,
  x: ORIGIN + CASCADE * floating,
  y: ORIGIN + CASCADE * floating,
});
