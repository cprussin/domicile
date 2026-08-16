// How the chrome reports an `<domicile-app>`'s on-screen box to the host.

import type { Matrix } from "./matrix";
import { accumulate, IDENTITY } from "./matrix";

/** An element's geometry in the form `place_portal` needs it. */
export type Measurement = {
  size: readonly [width: number, height: number];
  transform: Matrix;
  zIndex: number;
  visible: boolean;
};

export type Measure = (element: HTMLElement) => Measurement;

/**
 * Default DOM measurement: element-local size plus an element->screen affine.
 *
 * This first cut reports size + translation (via `getBoundingClientRect`) and
 * the element's own computed linear transform. Precise full-chain transform
 * capture (ancestor rotation/scale, transform-origin, 3D) is provided by the
 * engine integration, which already knows each layer's transform; that path
 * replaces this when running inside the compositor.
 */
export const defaultMeasure: Measure = (element) => {
  const box = element.getBoundingClientRect();
  const size = [
    firstNonZero(element.offsetWidth, box.width),
    firstNonZero(element.offsetHeight, box.height),
  ] as const;
  return {
    size,
    transform: accumulate([
      readLinearTransform(element),
      [1, 0, 0, 1, box.left, box.top],
    ]),
    visible: size[0] > 0 && size[1] > 0,
    zIndex: readZIndex(element),
  };
};

// Layout-dependent measurements read 0 before the element has a box; the
// caller wants the first source that actually produced one.
const firstNonZero = (preferred: number, fallback: number): number =>
  preferred > 0 ? preferred : fallback;

// The linear (non-translating) part of the element's own CSS transform.
// `DOMMatrix` is absent in some non-browser DOM implementations, where an
// identity linear part is the correct answer — those environments do no layout
// and so apply no transform either.
const readLinearTransform = (element: HTMLElement): Matrix => {
  const transform = getComputedStyle(element).transform;
  if (
    transform === "" ||
    transform === "none" ||
    typeof DOMMatrix === "undefined"
  ) {
    return IDENTITY;
  }
  const matrix = new DOMMatrix(transform);
  return [matrix.a, matrix.b, matrix.c, matrix.d, 0, 0];
};

// `z-index: auto` parses to NaN, which the host reads as the default layer.
const readZIndex = (element: HTMLElement): number => {
  const zIndex = Number.parseInt(getComputedStyle(element).zIndex, 10);
  return Number.isFinite(zIndex) ? zIndex : 0;
};
