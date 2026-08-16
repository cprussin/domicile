// Turning a pointer position on screen into a coordinate inside the Wayland
// client's surface.
//
// The chrome owns this mapping because pointer events land on the DOM element,
// not on the compositor. It is the inverse of the element->screen affine the
// chrome already ships to the host in `place_portal`, so an app under any CSS
// transform — rotated, scaled, skewed — still receives correct surface-local
// coordinates.

import type { Matrix, Point } from "./matrix";
import { apply, invert } from "./matrix";

export type SurfacePoint = { x: number; y: number };

/**
 * Map a screen position into the client surface's pixel space.
 *
 * @param surfaceSize - The client surface's pixel size. `[0, 0]` (no frame
 *   drawn yet) maps element pixels 1:1, which is the best guess available.
 * @returns `undefined` when the element has no area to map through — it has no
 *   layout box yet, or its transform is singular — so there is no meaningful
 *   coordinate to report.
 */
export const surfaceLocal = (
  elementToScreen: Matrix,
  [elementWidth, elementHeight]: Point,
  [surfaceWidth, surfaceHeight]: Point,
  screen: Point,
): SurfacePoint | undefined => {
  const screenToElement =
    elementWidth > 0 && elementHeight > 0 ? invert(elementToScreen) : undefined;
  if (screenToElement === undefined) {
    return undefined;
  } else {
    const [x, y] = apply(screenToElement, screen);
    return {
      x: x * surfaceScale(surfaceWidth, elementWidth),
      y: y * surfaceScale(surfaceHeight, elementHeight),
    };
  }
};

const surfaceScale = (surfaceExtent: number, elementExtent: number): number =>
  surfaceExtent > 0 ? surfaceExtent / elementExtent : 1;
