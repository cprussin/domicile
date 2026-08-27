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

/**
 * The smallest a window can be dragged down to.
 *
 * Not a taste: the corner a resize is driven from is inside the window, so a
 * window that can be made smaller than the grab is one that can be made
 * impossible to grab again. Taller than {@link TITLE_BAR} for the same reason
 * twice over — the bar comes out of this height, so a window that could be
 * dragged shorter than its own bar would have a surface of nothing and a frame
 * with nothing left to grab.
 */
const SMALLEST = { height: 120, width: 240 };

/**
 * The same box, moved.
 *
 * Kept on the stage at the top and the left, which are the two edges a window
 * dragged past cannot be dragged back from — the corner you would reach for is
 * off the screen. The right and the bottom are left alone: a window dragged
 * most of the way off those still has its top-left corner in reach.
 */
export const movedTo = (float: Float, x: number, y: number): Float => ({
  ...float,
  x: Math.max(0, x),
  y: Math.max(0, y),
});

/** The same box, resized, never below what is left to grab. */
export const sizedTo = (
  float: Float,
  width: number,
  height: number,
): Float => ({
  ...float,
  height: Math.max(SMALLEST.height, height),
  width: Math.max(SMALLEST.width, width),
});

/**
 * How tall a floating window's title bar is.
 *
 * It comes out of the window rather than being added to it: a float's box is
 * the whole frame, so a window dragged to a size is that size, bar included,
 * and a resize does not have to reason about a frame that grows with it.
 */
export const TITLE_BAR = 30;

/** What a floating window's box is made of: a bar over a client's surface. */
export type Box = {
  height: number;
  width: number;
  x: number;
  y: number;
};

/** The whole frame — the bar and the surface under it. */
export const frameBox = ({ height, width, x, y }: Float): Box => ({
  height,
  width,
  x,
  y,
});

/** Just the bar, along the top of it. */
export const barBox = (float: Float): Box => ({
  ...frameBox(float),
  height: TITLE_BAR,
});

/**
 * And the client's surface, under the bar.
 *
 * Never shorter than nothing: {@link sizedTo} keeps a window taller than its
 * own bar, so this stays positive — but a negative height would be reported to
 * the compositor as a window turned inside out, which is worth not relying on
 * a number in another module for.
 */
export const surfaceBox = (float: Float): Box => ({
  ...frameBox(float),
  height: Math.max(0, float.height - TITLE_BAR),
  y: float.y + TITLE_BAR,
});
