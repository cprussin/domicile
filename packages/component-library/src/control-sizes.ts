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
 * Per-size horizontal padding for control wrappers, in spacing-scale units.
 * Source of truth — read by the `control` recipe in `pandacss-preset.ts` and
 * by `_control/controlPadding.ts` to derive rounded-variant overrides and
 * pulled-trailing-group margins.
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
 * Per-size intrinsic control height, in spacing-scale units. Mirrors the
 * `blockSize` / `minBlockSize` set by the `control` recipe in
 * `pandacss-preset.ts`. Read by `Textarea` to clamp the user-supplied
 * `minHeight` to the size's natural height so a too-small `minHeight` can
 * never shrink the textarea below one line of the control.
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
