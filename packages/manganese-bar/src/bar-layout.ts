import type { ReactNode } from "react";

/**
 * The bar's three columns. `center` is centered on the screen regardless of the
 * other two, so a clock there does not shift as items change.
 */
export type BarLayout = {
  readonly left: readonly ReactNode[];
  readonly center: readonly ReactNode[];
  readonly right: readonly ReactNode[];
};
