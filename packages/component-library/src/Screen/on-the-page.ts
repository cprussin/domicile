// Where a place in the desktop's coordinates is on the page, once the region
// holding it has been drawn over the window it covers.

import { densityOf } from "./cover-the-window";
import type { Display, Scanout } from "./display-source";

/** A place, in whichever coordinates its caller is working in. */
export type Spot = readonly [x: number, y: number];

/**
 * `spot`, in the page's own coordinates — the ones a `PointerEvent` reports as
 * `clientX`/`clientY`.
 *
 * **WHY A SHELL CANNOT JUST USE THE NUMBER IT LAID A WINDOW OUT AT.** A region
 * that covers a window is drawn through a CSS transform — see
 * {@link coverTheWindow} — so a window laid out at 1800 logical pixels along a
 * 4K panel is *drawn* at 2160 of the page's. The page's own coordinates are
 * what anything outside layout speaks: where the pointer is, and where a shell
 * asks for it to be put. Reading a layout number as a page one is a place that
 * is right at the region's corner and further out the further from it, which
 * is what this exists to stop.
 *
 * Every desktop whose window is the whole page maps nothing and answers with
 * the spot it was given: there the region carries no transform, so the
 * desktop's logical pixels already are the page's. The same is true of a
 * display either side of which has no extent, because that is the case
 * `coverTheWindow` draws no transform for — what is mapped here and what is
 * drawn there are the same claim, and they agree by answering together.
 *
 * **THE FOUR TURNS ARE WRITTEN TWICE IN THIS DIRECTORY, ONCE AS CSS AND ONCE
 * AS ARITHMETIC**, because one is a string the engine applies and the other is
 * a point this has to land. {@link turnOf} below and `turn` in
 * `cover-the-window.ts` say the same thing about the same four rotations:
 * change either and change both, or a desk comes up drawn one way and pointed
 * at another.
 */
export const onThePage = (display: Display, spot: Spot): Spot => {
  const { position, scanout, size } = display;
  const density = scanout === undefined ? undefined : densityOf(size, scanout);
  if (scanout === undefined || density === undefined) {
    return spot;
  }
  // Out of the desktop's coordinates and into the region's own, because the
  // transform is about the region's top-left corner and not the page's.
  const local: Spot = [spot[0] - position[0], spot[1] - position[1]];
  // Scaled first, which is the order the CSS applies right to left: what is
  // turned is the box at the size it covers rather than its logical one.
  const turned = turnOf(scanout, [local[0] * density, local[1] * density]);
  return [turned[0] + position[0], turned[1] + position[1]];
};

/**
 * `spot` turned the way the monitor is bolted to the desk, and pushed back
 * over the window by whichever of its edges the turn swung behind the origin.
 *
 * The arithmetic half of `turn` in `cover-the-window.ts`, one arm each: a
 * quarter turn clockwise takes the region's top-left corner to the window's
 * top-right, so the window's width is what brings it back, and every logical
 * y runs back along the window's x.
 */
const turnOf = (
  { size: [modeWidth, modeHeight], transform }: Scanout,
  [x, y]: Spot,
): Spot => {
  switch (transform) {
    case "normal": {
      return [x, y];
    }
    case "rotate-90": {
      return [modeWidth - y, x];
    }
    case "rotate-180": {
      return [modeWidth - x, modeHeight - y];
    }
    case "rotate-270": {
      return [y, modeHeight - x];
    }
  }
};
