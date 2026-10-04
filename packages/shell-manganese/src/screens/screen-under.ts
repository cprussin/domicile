import type { Display } from "@domicile-desktop/component-library/display-source";

import type { Spot } from "../window-management/pointer-warp";

/**
 * The display containing `spot`, or `undefined` if none does.
 *
 * Works for both page kinds: a per-monitor page has its display at the origin,
 * and a whole-desktop page has every display at its place. Either way the
 * answer is the display whose rectangle contains the spot.
 *
 * Rectangles include their left and top edges only, so a shared edge belongs to
 * the screen that starts there.
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
