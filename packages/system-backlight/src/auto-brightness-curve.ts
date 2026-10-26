// The brightness automatic brightness asks for in a room's light, and how a
// level the user chose moves it.

/** The level in the dark, with nothing learned. */
const IN_THE_DARK = 0.1;

/** How much each tenfold of light adds. 10,000 lux, daylight, is full. */
const PER_DECADE = 0.225;

/** The dimmest level asked for; zero turns most panels off. */
const DIMMEST = 0.01;

/**
 * The level, 0 to 1, for `lux` of light, moved by `offset`: dim in the dark,
 * about half at 100 lux, full in daylight.
 */
export const brightnessFor = (lux: number, offset: number): number =>
  Math.min(1, Math.max(DIMMEST, curve(lux) + offset));

/** The offset that makes {@link brightnessFor} give `level` at `lux`. */
export const offsetFor = (lux: number, level: number): number =>
  level - curve(lux);

const curve = (lux: number): number =>
  IN_THE_DARK + PER_DECADE * Math.log10(1 + Math.max(0, lux));
