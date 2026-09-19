// Drawing a display's logical box over the whole of the window that IS that
// display.

import type { Scanout, Transform } from "./display-source";

/**
 * The CSS `transform` that maps a region's logical box onto the window it
 * covers, or `undefined` for a region that covers no window of its own.
 *
 * **Where the engine scans out, a page IS one monitor.** One browser window
 * per CRTC, each window the size of that monitor's mode in CSS pixels, each
 * told the single display it covers. So the shell lays a region out in logical
 * pixels — 1800×3200 for a 4K panel on its side at density 1.2 — inside a
 * window of 3840×2160, and without this the desktop is a small upright picture
 * in the corner of a black screen. Nothing else in the system can do it: the
 * compositor does not own the window, and the engine draws what the page says.
 *
 * **The two halves are one transform because they are one mapping.** The turn
 * without the scale is a desktop the right way up and the wrong size; the
 * scale without the turn is a desktop the right size and sideways. Both are
 * `mode ÷ box`, read across the turn.
 *
 * **Right to left, which is what puts `scale` first.** CSS applies the
 * rightmost function to the element and works outward, so the box is scaled to
 * the pixels it has to cover, *then* turned, *then* pushed back into view.
 * Written the other way the push would be measured in unscaled pixels and the
 * desktop would land off the screen by the difference.
 *
 * The push is needed because a rotation about the top-left corner takes the
 * box out of the window: a quarter turn clockwise puts every pixel at a
 * negative x, and the window's own width is what brings it back. Which corner
 * moves where is the whole of {@link turn}.
 *
 * @param box - the region's logical size, which is what it is laid out at.
 * @param scanout - the window this region covers, or `undefined` for a region
 *   that is a part of a page rather than the whole of one.
 */
export const coverTheWindow = (
  box: readonly [number, number],
  scanout: Scanout | undefined,
): string | undefined => {
  if (scanout === undefined) {
    return undefined;
  }
  const density = densityOf(box, scanout);
  if (density === undefined) {
    return undefined;
  }
  return `${turn(scanout)}scale(${String(density)})`;
};

/**
 * How many of the window's pixels one of the region's is worth.
 *
 * **Measured across the turn.** A quarter turn trades the monitor's width for
 * its height, so a box 1800 wide covers the mode's 2160 rather than its 3840.
 * Taking it along the turn instead gives 2.13 for this desk — a desktop drawn
 * nearly twice too large and off three edges, on a monitor that is otherwise
 * working.
 *
 * One number rather than two, because a display's logical size is its mode
 * over one density and the two axes cannot disagree. Read off the width
 * because a width is there; either would do.
 *
 * `undefined` where either side has no extent. Neither should be reachable —
 * a zero-sized display is refused by the config and by the page's schema, and
 * a window with no pixels is not a window — but the two arrive as separate
 * fields and this is the seam between them, so it refuses rather than
 * producing a region scaled to nothing.
 */
const densityOf = (
  [width, height]: readonly [number, number],
  { size: [modeWidth, modeHeight], transform }: Scanout,
): number | undefined => {
  const across = SWAPS_AXES[transform] ? modeHeight : modeWidth;
  if (width <= 0 || height <= 0 || modeWidth <= 0 || modeHeight <= 0) {
    return undefined;
  }
  return across / width;
};

/**
 * The rotation, and the translation that brings what it swung out of the
 * window back over it.
 *
 * `transform-origin` is the region's top-left corner, so a rotation about it
 * takes the box outside the window by whichever of its own edges the turn puts
 * behind the origin — and the window's own mode is the distance back. A half
 * turn puts both behind it; a quarter turn puts one.
 *
 * **Applied as written, because the name is already the content's turn.**
 * `wl_output`'s `transform_90` is an output rotated a quarter turn
 * counterclockwise, so what is drawn on it goes a quarter turn *clockwise* to
 * come out upright — and `rotate-90` names that clockwise turn, all the way
 * from the config file the user wrote. CSS measures positive angles clockwise,
 * so the two agree and the degrees below are the names in other units.
 *
 * **IF A DESK COMES UP UPSIDE DOWN, THIS FUNCTION IS THE FIX.** The two
 * quarter turns are the one thing in the whole path that a screen can settle
 * and reading cannot; swapping their two arms is the whole of it.
 *
 * Empty for `normal`, which would otherwise be a rotation by nothing and a
 * stacking context for free.
 */
const turn = ({
  size: [modeWidth, modeHeight],
  transform,
}: Scanout): string => {
  switch (transform) {
    case "normal": {
      return "";
    }
    // Clockwise: the box's left edge swings above the origin's x, so the
    // window's width is what brings it back.
    case "rotate-90": {
      return `translate(${String(modeWidth)}px, 0) rotate(90deg) `;
    }
    case "rotate-180": {
      return `translate(${String(modeWidth)}px, ${String(modeHeight)}px) rotate(180deg) `;
    }
    // Counterclockwise: the box's top edge swings above the origin's y instead.
    case "rotate-270": {
      return `translate(0, ${String(modeHeight)}px) rotate(-90deg) `;
    }
  }
};

/** Whether a turn trades the monitor's width for its height. */
const SWAPS_AXES: Record<Transform, boolean> = {
  normal: false,
  "rotate-90": true,
  "rotate-180": false,
  "rotate-270": true,
};
