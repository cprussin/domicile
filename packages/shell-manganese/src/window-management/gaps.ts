// Gaps between neighboring tiled windows and around them. Shared by the layout
// and by edge drags, which convert pixels to shares of the space between gaps.

import type { Rect } from "./rect";
import type { Tiling } from "./tree/tiling";
import { windowsOf } from "./tree/tiling";

/** `gaps.inner` from the config. */
const INNER_GAP = 20;

/** The gap inside a floating group, narrower since the group shares one box. */
const FLOATING_GAP = 10;

/**
 * The gap between the windows of `tiling`: `gaps.inner`, or 0 for a single
 * window (`gaps.smartGaps`).
 */
export const gapOf = (tiling: Tiling): number =>
  windowsOf(tiling).length > 1 ? INNER_GAP : 0;

/**
 * The part of the workspace `area` that `tiling` is laid out in: inset by
 * {@link gapOf}, so the focused window's glow has room at the screen's edges.
 */
export const tiledAreaOf = (tiling: Tiling, area: Rect): Rect => {
  const gap = gapOf(tiling);
  return {
    height: area.height - 2 * gap,
    width: area.width - 2 * gap,
    x: area.x + gap,
    y: area.y + gap,
  };
};

/** {@link gapOf} for a floating group. */
export const floatingGapOf = (tiling: Tiling): number =>
  windowsOf(tiling).length > 1 ? FLOATING_GAP : 0;
