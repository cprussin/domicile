// A rectangle of the desktop, and the two ways this shell cuts one up.
//
// The desktop's own coordinates throughout — the page spans every display, so
// the viewport *is* the desktop and a window at 0 is at its corner. Nothing
// here is a style: these are the runtime numbers a window is placed at, which
// is why they are plain pixels rather than tokens.

/** Where something is and how big, in the desktop's pixels. */
export type Rect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

/**
 * How tall a window's title bar is.
 *
 * It comes out of the window's rectangle rather than being added to it: a
 * window's box is the whole frame, so a window dragged to a size is that size,
 * bar included, and a resize does not have to reason about a frame that grows
 * with it.
 */
export const TITLE_BAR = 30;

/** The strip along the top of `rect` that a title bar occupies. */
export const barOf = (rect: Rect): Rect => ({ ...rect, height: TITLE_BAR });

/**
 * What is left of `rect` under its title bar.
 *
 * Never shorter than nothing: every rectangle a window is given is taller than
 * its own bar, and a negative height would reach the compositor as a window
 * turned inside out.
 */
export const surfaceOf = (rect: Rect): Rect => ({
  ...rect,
  height: Math.max(0, rect.height - TITLE_BAR),
  y: rect.y + TITLE_BAR,
});
