// Reading the `transform-origin` a CSS transform pivots about.

import type { Point } from "./matrix";

/**
 * Parse a *computed* `transform-origin` — a browser resolves the property to
 * absolute lengths, so the value is a `"<x>px <y>px"` pair (with an optional z
 * component this 2D mapping discards).
 *
 * @returns `undefined` when the value is not a computed length pair, which is
 *   what a DOM implementation that does no style resolution reports.
 */
export const parseTransformOrigin = (computed: string): Point | undefined => {
  const [x, y] = computed.split(" ").map((part) => Number.parseFloat(part));
  return x !== undefined &&
    y !== undefined &&
    !Number.isNaN(x) &&
    !Number.isNaN(y)
    ? [x, y]
    : undefined;
};
