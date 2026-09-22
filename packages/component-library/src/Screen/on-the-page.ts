// Where a place in the desktop's coordinates is on the page, and how far a
// travel across the page is across the desktop, once the region holding it has
// been drawn over the window it covers.

import { densityOf } from "./cover-the-window";
import type { Display, Scanout, Transform } from "./display-source";

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
 * **THE FOUR TURNS ARE WRITTEN THREE TIMES IN THIS DIRECTORY: ONCE AS CSS,
 * ONCE AS A PLACE, AND ONCE AS A DISTANCE**, because one is a string the
 * engine applies, one is a point this has to land, and one is a travel
 * {@link offThePage} has to undo. `turn` in `cover-the-window.ts`,
 * {@link turnOf} below and {@link straightened} beside it say the same thing
 * about the same four rotations: change one and change all three, or a desk
 * comes up drawn one way and pointed at another.
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

/** A distance, in whichever coordinates its caller is working in. */
export type Travel = readonly [dx: number, dy: number];

/**
 * `travel`, in the desktop's own coordinates rather than the page's — the
 * inverse of {@link onThePage}, and the one a drag needs.
 *
 * **A DISTANCE, NOT A PLACE, WHICH IS WHY NO POSITION APPEARS IN IT.** A
 * pointer is reported at a place and dragged by a difference, and the two do
 * not map the same way: a region's own position and the push its turn needs
 * are what separate two places, so they cancel between them. Mapping a
 * distance as though it were a place lands it on the far side of the desktop;
 * they are two functions for that reason and the types say which is which.
 *
 * What asks is anything that reads a pointer and writes a layout. A float
 * dragged by the difference between two `clientX` readings moves by the
 * window's pixels rather than the ones it was laid out in — a quarter of the
 * travel on a 4K panel at 2, and sideways to the hand on a monitor on its
 * side — so the window slides out from under the pointer holding it.
 */
export const offThePage = (display: Display, travel: Travel): Travel => {
  const { scanout, size } = display;
  const density = scanout === undefined ? undefined : densityOf(size, scanout);
  if (scanout === undefined || density === undefined) {
    return travel;
  } else {
    // Turned back first and scaled after, which is the order `onThePage`
    // undone: one is a rotation and the other a single number, so they
    // commute, and reading them in that order is what shows the two are
    // inverses.
    const straight = straightened(scanout.transform, travel);
    return [straight[0] / density, straight[1] / density];
  }
};

/**
 * `spot` turned the way the monitor is bolted to the desk, and pushed back
 * over the window by whichever of its edges the turn swung behind the origin.
 *
 * The arithmetic half of `turn` in `cover-the-window.ts`, one arm each: a
 * quarter turn clockwise takes the region's top-left corner to the window's
 * top-right, so the window's width is what brings it back, and every logical
 * y runs back along the window's x. {@link straightened} is this same turn
 * undone, for a distance rather than a place.
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

/**
 * `travel` turned back out of the window's axes into the desktop's.
 *
 * The inverse of {@link turnOf}'s rotation and none of its pushes: a push
 * moves both ends of a distance by the same amount and so moves neither end of
 * it relative to the other. The mode is what those pushes are measured in, and
 * that is why it is absent here.
 */
const straightened = (transform: Transform, [dx, dy]: Travel): Travel => {
  switch (transform) {
    case "normal": {
      return [dx, dy];
    }
    case "rotate-90": {
      return [dy, -dx];
    }
    case "rotate-180": {
      return [-dx, -dy];
    }
    case "rotate-270": {
      return [-dy, dx];
    }
  }
};
