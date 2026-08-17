/**
 * The rem value of a single step on the domicile spacing scale: step `N` resolves to
 * `N × 0.25rem`, so step 4 is `1rem`. This is the factor the preset builds its
 * spacing tokens from, and the single source of truth for the `step → rem`
 * conversion — imported by the preset that mints the tokens and by the runtime
 * helpers that reproduce a token's value inline.
 */
export const SPACING_STEP_REM = 0.25;

/**
 * Converts a spacing-scale step to the matching rem string. Used for the numeric
 * spacing values Panda can't tokenize into a class at build time because they
 * arrive at runtime — a control's `width`/`height` prop, a layout's `gap` — so
 * the inline style still lands on the same rem a static token would have.
 */
export const spacing = (steps: number): string =>
  `${steps * SPACING_STEP_REM}rem`;
