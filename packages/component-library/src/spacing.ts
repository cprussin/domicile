/**
 * Rem size of one spacing step, so step 4 is `1rem`.
 *
 * Shared by the preset's tokens and {@link spacing} so the two agree.
 */
export const SPACING_STEP_REM = 0.25;

/**
 * Converts a spacing step to a rem string, for values known only at runtime
 * such as a control's `width` prop.
 */
export const spacing = (steps: number): string =>
  `${steps * SPACING_STEP_REM}rem`;
