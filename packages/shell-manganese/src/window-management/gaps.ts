// How far apart neighboring tiled windows are.
//
// Its own module because two things need the one answer: the layout that puts
// the windows on screen, and a drag on a window's edge, whose pixels are a
// share of what is left between the gaps.

import type { Tiling } from "./tree/tiling";
import { windowsOf } from "./tree/tiling";

/** `gaps.inner` from the config. */
const INNER_GAP = 20;

/**
 * The gap between the windows of `tiling` — `gaps.inner`, with
 * `gaps.smartGaps`: a workspace showing one window has nothing to space it
 * away from, so it gets the screen.
 */
export const gapOf = (tiling: Tiling): number =>
  windowsOf(tiling).length > 1 ? INNER_GAP : 0;
