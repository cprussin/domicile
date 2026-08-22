// Recovering an element's exact local->screen affine from what the DOM will
// tell us about it.
//
// `getBoundingClientRect` reports the *axis-aligned* box of an element after
// its transform, which is not where the element's own coordinate system starts
// once it rotates or skews. Composing the transform's linear part with that box
// recovers the real mapping, which is what both `place_portal` and
// surface-local pointer coordinates need. `transform-origin` is not part of it
// — see `elementToScreen` for why it cannot be.

import type { Matrix, Point } from "./matrix";
import { apply, multiply, translate } from "./matrix";

/** What the DOM reports about one element, in the form the mapping needs. */
export type ElementGeometry = {
  /** The element's untransformed border-box size, in CSS pixels. */
  size: Point;
  /** The element's own computed CSS `transform`, linear part only. */
  linear: Matrix;
  /** Where the transformed element's bounding box sits on screen. */
  box: { left: number; top: number };
};

/**
 * The element's local-pixel -> screen affine.
 *
 * Local coordinates run from `(0, 0)` at the element's untransformed top-left
 * corner to `size`, exactly as CSS pixels inside the element do.
 *
 * `transform-origin` is not a parameter, because it cannot change the answer.
 * CSS applies a transform about its origin, which is the conjugation
 * `T(o) · L · T(-o)` — and conjugating by a translation leaves the linear part
 * `L` untouched, moving only the result. This then anchors that result to
 * where `getBoundingClientRect` says the box is, which subtracts exactly the
 * offset the origin introduced. The two cancel algebraically, not
 * approximately: every origin gives the same affine. Passing one in cost a
 * `getComputedStyle` string parse per window per frame and bought nothing.
 */
export const elementToScreen = ({
  size,
  linear,
  box,
}: ElementGeometry): Matrix => {
  const [left, top] = boundingCorner(linear, size);
  return multiply(translate(box.left - left, box.top - top), linear);
};

// The top-left of the transformed element's axis-aligned bounding box, in the
// same local-origin-relative space the transform produces. Subtracting it from
// `getBoundingClientRect` is what anchors the mapping to the screen.
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
