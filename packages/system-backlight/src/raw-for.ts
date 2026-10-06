import type { Backlight } from "./read-backlight";

/**
 * The raw value for `level`, clamped to 0..1 and rounded.
 *
 * Never zero: most panels turn off at zero, leaving no visible slider to raise
 * it again. Throws on a level that is not finite, which is a caller's bug.
 */
export const rawFor = ({ max }: Backlight, level: number): number => {
  if (Number.isFinite(level)) {
    return Math.max(1, Math.round(Math.min(1, Math.max(0, level)) * max));
  } else {
    throw new Error(`a brightness must be a number, not ${level}`);
  }
};
