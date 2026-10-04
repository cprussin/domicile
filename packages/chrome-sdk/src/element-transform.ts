// Computes an element's local-to-screen affine from DOM measurements.
//
// `getBoundingClientRect` gives the axis-aligned box after the transform, which
// is not the element's origin once it rotates or skews. Combining the box with
// the transform's linear part gives the exact mapping, which pointer
// coordinates are inverted through.

import type { Matrix, Point } from "./matrix";
import { apply, multiply, translate } from "./matrix";

/** DOM measurements of one element. */
export type ElementGeometry = {
  /** The element's untransformed border-box size, in CSS pixels. */
  size: Point;
  /** The element's own computed CSS `transform`, linear part only. */
  linear: Matrix;
  /** Where the transformed element's bounding box sits on screen. */
  box: { left: number; top: number };
};

/**
 * The element's local-pixel to screen affine.
 *
 * Local coordinates run from `(0, 0)` at the untransformed top-left corner to
 * `size`. `transform-origin` is not needed: it only translates the result, and
 * anchoring to the bounding box removes that translation exactly.
 */
export const elementToScreen = ({
  size,
  linear,
  box,
}: ElementGeometry): Matrix => {
  const [left, top] = boundingCorner(linear, size);
  return multiply(translate(box.left - left, box.top - top), linear);
};

// The top-left of the transformed element's axis-aligned bounding box,
// relative to the transformed local origin.
const boundingCorner = (matrix: Matrix, [width, height]: Point): Point => {
  const corners = (
    [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ] as const
  ).map((corner) => apply(matrix, corner));
  return [
    Math.min(...corners.map(([x]) => x)),
    Math.min(...corners.map(([, y]) => y)),
  ];
};
