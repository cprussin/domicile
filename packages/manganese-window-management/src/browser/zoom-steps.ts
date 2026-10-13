// Browser page zoom levels.
//
// Uses Chrome's levels (`kPresetBrowserZoomFactors` in Blink's
// `page_zoom.cc`) so zoom steps match what users expect. The engine accepts
// any factor in range; the shell picks the steps.

const ZOOM_FACTORS: readonly number[] = [
  0.25,
  1 / 3,
  0.5,
  2 / 3,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
  2.5,
  3,
  4,
  5,
];

const SMALLEST = 0.25;
const LARGEST = 5;

// Matches Blink's `ZoomValuesEqual`. Reported factors pass through a
// logarithm, so they are not exact.
const EPSILON = 0.001;

/** The level above `factor`, or the largest level at the top. */
export const zoomedIn = (factor: number): number =>
  ZOOM_FACTORS.find((step) => step > factor + EPSILON) ?? LARGEST;

/** The level below `factor`, or the smallest level at the bottom. */
export const zoomedOut = (factor: number): number =>
  ZOOM_FACTORS.findLast((step) => step < factor - EPSILON) ?? SMALLEST;

export const isFullyZoomedIn = (factor: number): boolean =>
  factor > LARGEST - EPSILON;

export const isFullyZoomedOut = (factor: number): boolean =>
  factor < SMALLEST + EPSILON;

export const isUnzoomed = (factor: number): boolean =>
  Math.abs(factor - 1) < EPSILON;

/** A factor as a percentage: `1.25` is `125%`. */
export const zoomPercent = (factor: number): string =>
  `${Math.round(factor * 100).toString()}%`;
