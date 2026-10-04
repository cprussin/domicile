// Converts a DOM `WheelEvent` to `wl_pointer` scroll values: a distance
// (`axis`) and a high-resolution step (`axis_value120`).
//
// The DOM reports deltas in pixels, lines or pages, so both values are derived
// from the fraction of a wheel detent the event represents.

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

// One detent in each `deltaMode` unit, per browser convention.
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

// Multiply first so pixel-mode deltas pass through exactly.
const rescale = (delta: number, target: number, perDetent: number): number =>
  (delta * target) / perDetent;
