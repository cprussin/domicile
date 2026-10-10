// Floating boxes: where a floating window sits on the desktop, and how big.
//
// A float holds a node, not a window. Like sway, it floats whatever
// `focus parent` selected, so its box has a tree of its own, laid out like a
// workspace. See packages/shell-manganese/docs/WINDOW-MANAGEMENT.md.

import type { Direction } from "../direction";
import { Axis, axisOf, isForward } from "../direction";
import type { Rect } from "../rect";
import { SURFACE_TUCK, TITLE_BAR } from "../rect";
import type { LayoutNode } from "../tree/node";
import { windowsIn } from "../tree/node";
import type { Tiling } from "../tree/tiling";
import { focusChainOf } from "../tree/tiling";
import type { SizeLimit } from "../window";

/**
 * A floating box, in desktop pixels.
 *
 * It is also a {@link Tiling}, so tree commands work inside a floating group.
 */
export type Float = {
  /** How far down its tree the commands point. See `Tiling`. */
  depth: number;
  height: number;
  /** The window or group in the box. */
  root: LayoutNode;
  /** Whether it came from the scratchpad, so `scratchpad show` hides it. */
  scratchpad: boolean;
  width: number;
  x: number;
  y: number;
};

/**
 * The edges a resize drags: two for a corner, or one with the other axis
 * `undefined`.
 */
export type Grip = {
  horizontal: Direction | undefined;
  vertical: Direction | undefined;
};

/** The size of a newly floated window, when the screen has room. */
const OPENS_AT = { height: 800, width: 1280 };

/**
 * How far each float is offset from the one before it.
 *
 * Without the offset, a new float exactly covers the last one and looks like
 * it moved.
 */
const CASCADE = 36;

/** Where the first float sits. */
const ORIGIN = 48;

/** How far one keyed `move` or `resize` shifts a floating window. */
export const FLOAT_STEP = 10;

/**
 * A box for a window leaving the tiling, cascaded past `floating` existing
 * floats.
 *
 * Cascades by count, not from the last box, so a float dragged into a corner
 * does not push the next one off screen. Fits on `screen` with {@link ORIGIN}
 * to spare on each side.
 */
export const floatFor = (
  root: LayoutNode,
  floating: number,
  screen: Pick<Rect, "height" | "width">,
): Float => ({
  depth: focusChainOf(root).length,
  height: fitted(OPENS_AT.height, screen.height, SMALLEST.height),
  root,
  scratchpad: false,
  width: fitted(OPENS_AT.width, screen.width, SMALLEST.width),
  x: ORIGIN + CASCADE * floating,
  y: ORIGIN + CASCADE * floating,
});

/**
 * A scratchpad window's box: the whole of `screen` but for {@link ORIGIN} at
 * the sides and bottom. It hangs from the top edge, from which it slides in
 * and out.
 */
export const scratchpadFloatFor = (
  root: LayoutNode,
  screen: Pick<Rect, "height" | "width">,
): Float => ({
  depth: focusChainOf(root).length,
  height: Math.max(SMALLEST.height, screen.height - ORIGIN),
  root,
  scratchpad: true,
  width: Math.max(SMALLEST.width, screen.width - 2 * ORIGIN),
  x: ORIGIN,
  y: 0,
});

/**
 * A cascaded box for a window that asked for a size, such as from an
 * extension's `chrome.windows.create`. A 0 axis gets the default size.
 */
export const floatAskedFor = (
  root: LayoutNode,
  floating: number,
  screen: Pick<Rect, "height" | "width">,
  width: number,
  height: number,
): Float => {
  const float = floatFor(root, floating, screen);
  return sizedTo(
    float,
    width === 0 ? float.width : width,
    height === 0 ? float.height : height,
  );
};

/**
 * The box with its tree changed by `into`.
 *
 * Returns the same object when nothing changed, to avoid re-renders. Throws if
 * the box ends up empty; no command used here removes a window.
 */
export const retiled = (
  float: Float,
  into: (tiling: Tiling) => Tiling,
): Float => {
  const { depth, root } = into(float);
  if (root === undefined) {
    throw new Error("float: a command emptied a floating box");
  } else if (depth === float.depth && root === float.root) {
    return float;
  } else {
    return { ...float, depth, root };
  }
};

/** Whether the window `id` is in this box. */
export const floatHolds = (float: Float, id: string): boolean =>
  windowsIn(float.root).includes(id);

/**
 * The smallest size a resize allows.
 *
 * Resize grips sit inside the window, so a smaller window could become
 * impossible to grab. The height includes {@link TITLE_BAR}, so it must exceed
 * it.
 */
const SMALLEST = { height: 120, width: 240 };

/** How much of a float's height is not its client's. See `surfaceOf`. */
const BAR_OVER_SURFACE = TITLE_BAR - SURFACE_TUCK;

/**
 * The box with its contents clamped to the client's `min` and `max` size,
 * plus the title bar.
 *
 * Without this, the client's frame would not fill the box. An edge unchanged
 * since `before` stays put, so a window resized from the left stops at its
 * smallest instead of sliding right.
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
    minHeight === undefined ? undefined : minHeight + BAR_OVER_SURFACE,
    maxHeight === undefined ? undefined : maxHeight + BAR_OVER_SURFACE,
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

/** The box moved to `x`, `y`, even off the desktop. */
export const movedTo = (float: Float, x: number, y: number): Float => ({
  ...float,
  x,
  y,
});

/**
 * The box in page pixels instead of `screen` pixels. The page spans every
 * screen.
 */
export const onScreen = (float: Float, screen: Rect): Float =>
  movedTo(float, float.x + screen.x, float.y + screen.y);

/** The box resized, never below {@link SMALLEST}. */
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
 * The box with the edges in `grip` dragged by `dx`, `dy`. Opposite edges stay
 * put.
 *
 * Clamps at the dragged edge, so a window resized from the left to its
 * smallest does not slide right.
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

/** The box shifted one step in `direction`, for a keyed `move`. */
export const shifted = (float: Float, direction: Direction): Float => {
  const step = isForward(direction) ? FLOAT_STEP : -FLOAT_STEP;
  return axisOf(direction) === Axis.Horizontal
    ? movedTo(float, float.x + step, float.y)
    : movedTo(float, float.x, float.y + step);
};

/** The box one step bigger or smaller, for resize mode. */
export const grown = (float: Float, direction: Direction): Float => {
  const step = isForward(direction) ? FLOAT_STEP : -FLOAT_STEP;
  return axisOf(direction) === Axis.Horizontal
    ? sizedTo(float, float.width + step, float.height)
    : sizedTo(float, float.width, float.height + step);
};

/** The whole frame: the title bar and the contents under it. */
export const rectOf = ({ height, width, x, y }: Float): Rect => ({
  height,
  width,
  x,
  y,
});

/**
 * One axis of {@link floatFor}: `size`, shrunk to fit `room` with
 * {@link ORIGIN} on each side, but never below `smallest`.
 */
const fitted = (size: number, room: number, smallest: number): number =>
  Math.max(smallest, Math.min(size, room - 2 * ORIGIN));

/** Where a box starts along one axis, and how far it goes. */
type Span = { size: number; start: number };

/**
 * One axis of {@link stretched}: drags the far edge if `atEnd`, else the near
 * edge, which stops at the desktop's edge.
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
 * One axis of {@link limitedTo}: clamps the size between `min` and `max`,
 * anchored at the far edge if only the near edge moved since `before`.
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
