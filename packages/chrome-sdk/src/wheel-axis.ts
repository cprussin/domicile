// Converting a DOM `WheelEvent` into the two things `wl_pointer` wants for a
// scroll: a continuous surface-local distance (`axis`) and a discrete
// high-resolution step (`axis_value120`).
//
// The DOM reports scroll in one of three units depending on the device and the
// browser, so both outputs are derived from a single normalised quantity — how
// much of a classic wheel detent the event represents.

/** The subset of `WheelEvent` the conversion reads. */
export type WheelDelta = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
};

/** A scroll expressed for `wl_pointer`, per axis. */
export type AxisDelta = {
  dx: number;
  dy: number;
  v120X: number;
  v120Y: number;
};

// `wl_pointer.axis_value120` counts 120 units per detent of a classic wheel.
const UNITS_PER_DETENT = 120;

// What one detent measures in each of the DOM's delta units, and the pixel
// distance a detent scrolls — the conventions browsers themselves use.
const PIXELS_PER_DETENT = 100;
const DETENT_BY_DELTA_MODE: Readonly<Record<number, number>> = {
  0: PIXELS_PER_DETENT,
  1: 3,
  2: 1,
};

/** Convert a wheel event's deltas into `wl_pointer` axis values. */
export const axisFromWheel = ({
  deltaX,
  deltaY,
  deltaMode,
}: WheelDelta): AxisDelta => {
  const perDetent = DETENT_BY_DELTA_MODE[deltaMode];
  if (perDetent === undefined) {
    throw new RangeError(
      `unknown WheelEvent.deltaMode: ${deltaMode.toString()}`,
    );
  }
  return {
    dx: rescale(deltaX, PIXELS_PER_DETENT, perDetent),
    dy: rescale(deltaY, PIXELS_PER_DETENT, perDetent),
    v120X: Math.round(rescale(deltaX, UNITS_PER_DETENT, perDetent)),
    v120Y: Math.round(rescale(deltaY, UNITS_PER_DETENT, perDetent)),
  };
};

// Multiplying before dividing keeps a whole number of detents exact, which
// matters because the common case is a pixel-mode wheel that must pass through
// its own delta untouched.
const rescale = (delta: number, target: number, perDetent: number): number =>
  (delta * target) / perDetent;
