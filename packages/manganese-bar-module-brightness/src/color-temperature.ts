/** The screen's own white, in kelvin: no tint. */
export const NEUTRAL = 6500;

/** The night light at warmth 0, and at 100, in kelvin. */
const LEAST_WARM = 6000;
const MOST_WARM = 2000;

/**
 * The color temperature for a night light at `warmth` (0 to 100), eased in by
 * `strength` (0 to 1). Steps evenly in mireds, which look even to the eye: 50
 * is about 3000K.
 */
export const colorTemperature = (warmth: number, strength: number): number => {
  const full = mixMireds(LEAST_WARM, MOST_WARM, warmth / 100);
  return Math.round(mixMireds(NEUTRAL, full, strength));
};

const mixMireds = (from: number, to: number, by: number): number =>
  1e6 / (1e6 / from + (1e6 / to - 1e6 / from) * by);
