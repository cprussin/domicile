import type { Display } from "@domicile/component-library/display-source";

import type { Spot } from "../window-management/pointer-warp";

/**
 * The display a pointer at `spot` is on, or `undefined` off every one of them.
 *
 * **ONE ANSWER FOR BOTH KINDS OF PAGE.** A page that is one monitor is told
 * the whole desk with its own display at the origin, so every spot it hears a
 * pointer at is inside that display; a page that is the whole desktop has
 * every display at its own place on it. Either way the display is the one
 * whose rectangle holds the spot.
 *
 * Its left and top edges and not its right and bottom ones, so the column two
 * screens share belongs to the one that starts there.
 */
export const screenUnder = (
  displays: readonly Display[],
  spot: Spot,
): string | undefined =>
  displays.find(
    ({ position: [x, y], size: [width, height] }) =>
      spot[0] >= x &&
      spot[0] < x + width &&
      spot[1] >= y &&
      spot[1] < y + height,
  )?.name;
