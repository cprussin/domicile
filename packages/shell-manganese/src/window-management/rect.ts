// Desktop rectangles, split into title bar and contents.
//
// The page spans every display, so these are desktop pixels. They are runtime
// values, not style tokens.

/** A position and size in desktop pixels. */
export type Rect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

/**
 * The title bar height.
 *
 * The bar is inside the window's box, so a window's size includes its bar.
 */
export const TITLE_BAR = 30;

/** The strip along the top of `rect` that a title bar occupies. */
export const barOf = (rect: Rect): Rect => ({ ...rect, height: TITLE_BAR });

/**
 * How far a window's surface reaches up under its title bar, in CSS pixels.
 *
 * The bar draws over the surface. At fractional scales the two edges land
 * between device pixels and blend with what is behind them; with the surface
 * tucked under, that is the surface, not a sliver of the desktop.
 */
export const SURFACE_TUCK = 1;

/**
 * The part of `rect` below its title bar, tucked {@link SURFACE_TUCK} under
 * it.
 *
 * Clamped at 0 height, since a negative height would break the compositor.
 */
export const surfaceOf = (rect: Rect): Rect => ({
  ...rect,
  height: Math.max(0, rect.height - TITLE_BAR + SURFACE_TUCK),
  y: rect.y + TITLE_BAR - SURFACE_TUCK,
});

/** `rect` reaching {@link SURFACE_TUCK} up under the bar above it. */
export const tuckedUnderBar = (rect: Rect): Rect => ({
  ...rect,
  height: rect.height + SURFACE_TUCK,
  y: rect.y - SURFACE_TUCK,
});
