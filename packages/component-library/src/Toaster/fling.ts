/** Where the pointer was, and when, in ms. */
export type PointerSample = {
  readonly time: number;
  readonly x: number;
  readonly y: number;
};

/** The pointer's speed over its last two samples, in px/ms; 0 without two. */
export const pointerSpeed = (samples: readonly PointerSample[]): number => {
  const last = samples.at(-1);
  const before = samples.at(-2);
  return last === undefined || before === undefined || last.time === before.time
    ? 0
    : Math.hypot(last.x - before.x, last.y - before.y) /
        (last.time - before.time);
};

/**
 * How long a toast flung at `speed` px/ms takes to cover `distance` px at that
 * speed: at most `longest`, how long it takes released at rest.
 */
export const flingMs = (
  distance: number,
  speed: number,
  longest: number,
): number => (speed > 0 ? Math.min(longest, distance / speed) : longest);
