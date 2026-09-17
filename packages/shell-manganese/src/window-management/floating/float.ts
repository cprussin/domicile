// A window that is floating rather than tiled: where it sits on the desktop,
// and how big.
//
// Its own module rather than a field on `ShellWindow` because floating is not
// a kind of window — any window can be floated and put back, and a client's
// portal is the same portal either way. What changes is where the shell lays
// it out, which is exactly what this describes.

import type { Direction } from "../direction";
import { Axis, axisOf, isForward } from "../direction";
import type { Rect } from "../rect";
import { TITLE_BAR } from "../rect";

/** Where a floating window sits, in the desktop's own pixels. */
export type Float = {
  height: number;
  /** The window this is the box of. */
  id: string;
  /**
   * Whether it is up from the scratchpad, so `scratchpad show` hides it again
   * rather than fetching the next one.
   */
  scratchpad: boolean;
  width: number;
  x: number;
  y: number;
};

/** How big a window is when it first leaves the tiling. */
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

/** How far one keyed `move` or `resize` shifts a floating window. */
export const FLOAT_STEP = 10;

/**
 * A box for a window leaving the tiling, cascaded past the `floating` boxes
 * already out there.
 *
 * The count rather than the last box's corner: dragging a window into the
 * corner must not put the next one off the screen, and the count is what says
 * how many are already out regardless of where the user has since put them.
 */
export const floatFor = (
  id: string,
  floating: number,
  scratchpad = false,
): Float => ({
  ...OPENS_AT,
  id,
  scratchpad,
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
 * Kept on the desktop at the top and the left, which are the two edges a
 * window dragged past cannot be dragged back from — the corner you would
 * reach for is off the screen. The right and the bottom are left alone: a
 * window dragged most of the way off those still has its top-left corner in
 * reach.
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

/** The same box, shifted one step `direction` — what a keyed `move` does. */
export const shifted = (float: Float, direction: Direction): Float => {
  const step = isForward(direction) ? FLOAT_STEP : -FLOAT_STEP;
  return axisOf(direction) === Axis.Horizontal
    ? movedTo(float, float.x + step, float.y)
    : movedTo(float, float.x, float.y + step);
};

/** The same box, one step bigger or smaller — what resize mode does. */
export const grown = (float: Float, direction: Direction): Float => {
  const step = isForward(direction) ? FLOAT_STEP : -FLOAT_STEP;
  return axisOf(direction) === Axis.Horizontal
    ? sizedTo(float, float.width + step, float.height)
    : sizedTo(float, float.width, float.height + step);
};

/** The whole frame — the bar and the window's contents under it. */
export const rectOf = ({ height, width, x, y }: Float): Rect => ({
  height,
  width,
  x,
  y,
});
