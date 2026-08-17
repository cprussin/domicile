import type { CSSProperties } from "react";

import { spacing } from "../spacing";

/**
 * Builds the inline-style object Input/Textarea use to override the wrapper's
 * dimensions. The numeric props on those components are interpreted as
 * spacing-scale steps (matching the preset's `step × 0.25rem` formula), so
 * `width: 80` becomes `inlineSize: "20rem"`. Returns `undefined` (rather than
 * an empty object) when nothing is set so React doesn't bother applying a
 * style attribute.
 */
type Dimensions = {
  height?: number | undefined;
  maxHeight?: number | undefined;
  minHeight?: number | undefined;
  width?: number | undefined;
};

export const controlSizingStyle = (
  dimensions: Dimensions,
): CSSProperties | undefined => {
  const style: CSSProperties = {};
  if (dimensions.width !== undefined) {
    style.inlineSize = spacing(dimensions.width);
  }
  if (dimensions.height !== undefined) {
    style.blockSize = spacing(dimensions.height);
  }
  if (dimensions.minHeight !== undefined) {
    style.minBlockSize = spacing(dimensions.minHeight);
  }
  if (dimensions.maxHeight !== undefined) {
    style.maxBlockSize = spacing(dimensions.maxHeight);
  }
  return Object.keys(style).length === 0 ? undefined : style;
};
