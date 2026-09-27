// How far a browser window's page zooms, a step at a time.
//
// Chrome's own levels — `kPresetBrowserZoomFactors` in Blink's `page_zoom.cc`
// — because they are the ones a user's hands already know: Ctrl+plus from
// 100% is 110%, and five presses is 175%. The engine takes any factor between
// the first and the last; which ones a press lands on is the shell's to say.

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

// Blink's `ZoomValuesEqual`. A factor the browser reports has been through a
// logarithm and back, so a third set is not exactly a third read.
const EPSILON = 0.001;

/**
 * The level above `factor`, or the last level when there is none — a press
 * past the end is still a press, and shows the user where the end is.
 */
export const zoomedIn = (factor: number): number =>
  ZOOM_FACTORS.find((step) => step > factor + EPSILON) ?? LARGEST;

/** The level below `factor`, or the first level when there is none. */
export const zoomedOut = (factor: number): number =>
  ZOOM_FACTORS.findLast((step) => step < factor - EPSILON) ?? SMALLEST;

export const isFullyZoomedIn = (factor: number): boolean =>
  factor > LARGEST - EPSILON;

export const isFullyZoomedOut = (factor: number): boolean =>
  factor < SMALLEST + EPSILON;

export const isUnzoomed = (factor: number): boolean =>
  Math.abs(factor - 1) < EPSILON;

/** A factor as the percentage a browser shows for it: `1.25` is `125%`. */
export const zoomPercent = (factor: number): string =>
  `${Math.round(factor * 100).toString()}%`;
