// Gaps between neighboring tiled windows and around them. Shared by the layout
// and by edge drags, which convert pixels to shares of the space between gaps.

import type { Rect } from "./rect";
import type { Tiling } from "./tree/tiling";
import { windowsOf } from "./tree/tiling";

/** `gaps.inner` from the config, around tiled windows and between them. */
export const INNER_GAP = 20;

/** The gap inside a floating group, narrower since the group shares one box. */
const FLOATING_GAP = 10;

/**
 * The part of the workspace `area` that tiled windows are laid out in: inset by
 * {@link INNER_GAP}, even for a lone window, so the focused window's glow has
 * room at the screen's edges.
 */
export const tiledAreaOf = (area: Rect): Rect => ({
  height: area.height - 2 * INNER_GAP,
  width: area.width - 2 * INNER_GAP,
  x: area.x + INNER_GAP,
  y: area.y + INNER_GAP,
});

/** The gap between the windows of a floating group: 0 for a lone window. */
export const floatingGapOf = (tiling: Tiling): number =>
  windowsOf(tiling).length > 1 ? FLOATING_GAP : 0;
