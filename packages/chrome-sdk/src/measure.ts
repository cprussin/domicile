// How the chrome reports an `<domicile-app>`'s on-screen box to the host.

import { elementToScreen } from "./element-transform";
import type { Matrix, Point } from "./matrix";
import { IDENTITY } from "./matrix";
import { parseTransformOrigin } from "./transform-origin";

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
 * The affine composes the element's own CSS transform (about its
 * `transform-origin`) with where `getBoundingClientRect` puts the result, so a
 * rotated or scaled app maps correctly in both directions. An *ancestor* that
 * rotates or skews is still missed — `getBoundingClientRect` only reports an
 * axis-aligned box, so there is nothing left to recover it from. The engine
 * integration, which knows each layer's transform outright, replaces this when
 * running inside the compositor.
 */
export const defaultMeasure: Measure = (element) => {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const size = [
    firstNonZero(element.offsetWidth, box.width),
    firstNonZero(element.offsetHeight, box.height),
  ] as const;
  return {
    size,
    transform: elementToScreen({
      box,
      linear: readElementTransform(style),
      // An uncomputed origin means a DOM implementation that resolves no
      // style, where the CSS initial value (the element's centre) applies.
      origin: parseTransformOrigin(style.transformOrigin) ?? centreOf(size),
      size,
    }),
    visible: size[0] > 0 && size[1] > 0,
    zIndex: readZIndex(style),
  };
};

// Layout-dependent measurements read 0 before the element has a box; the
// caller wants the first source that actually produced one.
const firstNonZero = (preferred: number, fallback: number): number =>
  preferred > 0 ? preferred : fallback;

// The element's own CSS transform. `DOMMatrix` is absent in some non-browser
// DOM implementations, where an identity transform is the correct answer —
// those environments do no layout and so apply no transform either.
const readElementTransform = (style: CSSStyleDeclaration): Matrix => {
  const transform = style.transform;
  if (
    transform === "" ||
    transform === "none" ||
    typeof DOMMatrix === "undefined"
  ) {
    return IDENTITY;
  }
  const matrix = new DOMMatrix(transform);
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
};

const centreOf = ([width, height]: Point): Point => [width / 2, height / 2];

// `z-index: auto` parses to NaN, which the host reads as the default layer.
const readZIndex = (style: CSSStyleDeclaration): number => {
  const zIndex = Number.parseInt(style.zIndex, 10);
  return Number.isFinite(zIndex) ? zIndex : 0;
};
