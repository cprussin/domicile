export const SIZES = [
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
] as const;
export type Size = (typeof SIZES)[number];

/**
 * Inline padding of control wrappers for each size, in spacing steps.
 *
 * The `control` recipe in `pandacss-preset.ts` reads this.
 */
export const CONTROL_PADDING_INLINE = {
  "2xl": 5.5,
  "3xl": 7.5,
  "4xl": 10,
  lg: 3.5,
  md: 3,
  sm: 2.5,
  xl: 4,
  xs: 1.5,
} as const satisfies Record<Size, number>;

/**
 * Control height for each size, in spacing steps.
 *
 * Must match the `control` recipe in `pandacss-preset.ts`. `Textarea` uses it
 * as the floor for `minHeight`.
 */
export const CONTROL_HEIGHT = {
  "2xl": 16,
  "3xl": 22,
  "4xl": 30,
  lg: 10,
  md: 8,
  sm: 6,
  xl: 12,
  xs: 5,
} as const satisfies Record<Size, number>;
