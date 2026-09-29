// A window that is floating rather than tiled: where it sits on the desktop,
// and how big.
//
// Its own module rather than a field on `ShellWindow` because floating is not
// a kind of window — any window can be floated and put back, and a client's
// portal is the same portal either way. What changes is where the shell lays
// it out, which is exactly what this describes.
//
// **What floats is a node, not a window.** sway floats whatever `focus parent`
// selected, so a float holds a tree of its own — one window, most of the time
// — laid out inside its box the way the tiling lays out a workspace.

import type { Direction } from "../direction";
import { Axis, axisOf, isForward } from "../direction";
import type { Rect } from "../rect";
import { TITLE_BAR } from "../rect";
import type { LayoutNode } from "../tree/node";
import { windowsIn } from "../tree/node";
import type { SizeLimit } from "../window";

/** Where a floating window sits, in the desktop's own pixels. */
export type Float = {
  height: number;
  /** What floats in the box: a window, or a group of them. */
  root: LayoutNode;
  /**
   * Whether it is up from the scratchpad, so `scratchpad show` hides it again
   * rather than fetching the next one.
   */
  scratchpad: boolean;
  width: number;
  x: number;
  y: number;
};

/**
 * The edges a resize drags: a corner's two, or one edge's one with the other
 * axis `undefined`. A `Corner` is one of these.
 */
export type Grip = {
  horizontal: Direction | undefined;
  vertical: Direction | undefined;
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
  root: LayoutNode,
  floating: number,
  scratchpad = false,
): Float => ({
  ...OPENS_AT,
  root,
  scratchpad,
  x: ORIGIN + CASCADE * floating,
  y: ORIGIN + CASCADE * floating,
});

/** Whether the window `id` is in this box. */
export const floatHolds = (float: Float, id: string): boolean =>
  windowsIn(float.root).includes(id);

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
 * The same box, sized to what its client will draw: its contents no smaller
 * than `min` and no larger than `max`, with the bar on top.
 *
 * A box outside them gets a frame that does not fill it — cut off at the
 * box's edge, or stretched across it. An edge the box had `before` stays
 * where it was, so a window dragged in from the left stops at its smallest
 * rather than sliding right.
 */
export const limitedTo = (
  float: Float,
  before: Float | undefined,
  [minWidth, minHeight]: SizeLimit,
  [maxWidth, maxHeight]: SizeLimit,
): Float => {
  const across = spanLimited(
    { size: float.width, start: float.x },
    before === undefined ? undefined : { size: before.width, start: before.x },
    minWidth,
    maxWidth,
  );
  const down = spanLimited(
    { size: float.height, start: float.y },
    before === undefined ? undefined : { size: before.height, start: before.y },
    minHeight === undefined ? undefined : minHeight + TITLE_BAR,
    maxHeight === undefined ? undefined : maxHeight + TITLE_BAR,
  );
  return across.size === float.width &&
    across.start === float.x &&
    down.size === float.height &&
    down.start === float.y
    ? float
    : {
        ...float,
        height: down.size,
        width: across.size,
        x: across.start,
        y: down.start,
      };
};

/** The same box, moved — off any edge of the desktop, if that is where it went. */
export const movedTo = (float: Float, x: number, y: number): Float => ({
  ...float,
  x,
  y,
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
 * The same box with its `grip` dragged `dx`, `dy`: the edges it holds move and
 * the ones across from them stay put. An axis the grip has no side on does not
 * move at all.
 *
 * Stopped where {@link sizedTo} and {@link movedTo} would stop it, but by the
 * dragged edge: a window dragged from the left to its smallest must not start
 * sliding right instead.
 */
export const stretched = (
  float: Float,
  { horizontal, vertical }: Grip,
  dx: number,
  dy: number,
): Float => {
  const across =
    horizontal === undefined
      ? { size: float.width, start: float.x }
      : spanStretched(
          { size: float.width, start: float.x },
          isForward(horizontal),
          dx,
          SMALLEST.width,
        );
  const down =
    vertical === undefined
      ? { size: float.height, start: float.y }
      : spanStretched(
          { size: float.height, start: float.y },
          isForward(vertical),
          dy,
          SMALLEST.height,
        );
  return {
    ...float,
    height: down.size,
    width: across.size,
    x: across.start,
    y: down.start,
  };
};

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

/** Where a box starts along one axis, and how far it goes. */
type Span = { size: number; start: number };

/**
 * One axis of {@link stretched}: its far edge dragged `by` if `atEnd`, else
 * its near one, which stops at the desktop's edge.
 */
const spanStretched = (
  { size, start }: Span,
  atEnd: boolean,
  by: number,
  smallest: number,
): Span => {
  const end = start + size;
  const moved = Math.min(Math.max(0, start + by), end - smallest);
  return atEnd
    ? { size: Math.max(smallest, size + by), start }
    : { size: end - moved, start: moved };
};

/**
 * One axis of {@link limitedTo}: the size held between `min` and `max`, from
 * the far edge where only the near one moved since `before`.
 */
const spanLimited = (
  { size, start }: Span,
  before: Span | undefined,
  min: number | undefined,
  max: number | undefined,
): Span => {
  const limited = Math.min(
    max ?? Number.POSITIVE_INFINITY,
    Math.max(min ?? 0, size),
  );
  const end = start + size;
  const nearEdgeDragged =
    before !== undefined &&
    before.start !== start &&
    before.start + before.size === end;
  return nearEdgeDragged
    ? { size: limited, start: end - limited }
    : { size: limited, start };
};
