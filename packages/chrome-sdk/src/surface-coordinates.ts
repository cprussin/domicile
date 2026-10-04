// Maps a screen position to a Wayland surface's pixel coordinates.
//
// The page does this because the compositor does not know where windows are
// drawn. Inverting the element's full transform from `measure` keeps it correct
// under any CSS transform.

import type { Matrix, Point } from "./matrix";
import { apply, invert } from "./matrix";

export type SurfacePoint = { x: number; y: number };

/**
 * Map a screen position into the client surface's pixel space.
 *
 * @param surfaceSize - The client surface's pixel size. `[0, 0]` (nothing
 *   drawn yet) maps element pixels 1:1.
 * @returns `undefined` when the element has no layout box or its transform is
 *   singular.
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
