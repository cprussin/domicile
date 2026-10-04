import type { CSSProperties } from "react";

import { spacing } from "../spacing";

type Dimensions = {
  height?: number | undefined;
  maxHeight?: number | undefined;
  minHeight?: number | undefined;
  width?: number | undefined;
};

/**
 * Inline styles for a control wrapper's size props, in spacing steps
 * (`width: 80` is `20rem`). Returns `undefined` when no size is set.
 */
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
