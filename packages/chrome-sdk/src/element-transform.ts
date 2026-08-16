// Recovering an element's exact local->screen affine from what the DOM will
// tell us about it.
//
// `getBoundingClientRect` reports the *axis-aligned* box of an element after
// its transform, which is not where the element's own coordinate system starts
// once it rotates or skews. Composing the element's CSS transform (applied
// about its `transform-origin`) with that box recovers the real mapping, which
// is what both `place_portal` and surface-local pointer coordinates need.

import type { Matrix, Point } from "./matrix";
import { apply, multiply, translate } from "./matrix";

/** What the DOM reports about one element, in the form the mapping needs. */
export type ElementGeometry = {
  /** The element's untransformed border-box size, in CSS pixels. */
  size: Point;
  /** `transform-origin`, in the element's untransformed local pixels. */
  origin: Point;
  /** The element's own computed CSS `transform`, expressed about `origin`. */
  linear: Matrix;
  /** Where the transformed element's bounding box sits on screen. */
  box: { left: number; top: number };
};

/**
 * The element's local-pixel -> screen affine.
 *
 * Local coordinates run from `(0, 0)` at the element's untransformed top-left
 * corner to `size`, exactly as CSS pixels inside the element do.
 */
export const elementToScreen = ({
  size,
  origin,
  linear,
  box,
}: ElementGeometry): Matrix => {
  const aboutOrigin = transformAboutOrigin(linear, origin);
  const [left, top] = boundingCorner(aboutOrigin, size);
  return multiply(translate(box.left - left, box.top - top), aboutOrigin);
};

// CSS applies `transform` about `transform-origin`, so the raw matrix has to be
// conjugated by a translation to express it in the element's local coordinates.
const transformAboutOrigin = (linear: Matrix, [x, y]: Point): Matrix =>
  multiply(multiply(translate(x, y), linear), translate(-x, -y));

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
