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
 * The part of `rect` below its title bar.
 *
 * Clamped at 0 height, since a negative height would break the compositor.
 */
export const surfaceOf = (rect: Rect): Rect => ({
  ...rect,
  height: Math.max(0, rect.height - TITLE_BAR),
  y: rect.y + TITLE_BAR,
});
