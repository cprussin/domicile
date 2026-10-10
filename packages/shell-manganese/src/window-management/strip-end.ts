import type { Rect } from "./rect";
import type { StripPlace } from "./tree/frames";

/**
 * The empty end of a tabbed strip, past its last tab, for the tab at `bar` in
 * `strip`. `undefined` for any other tab or bar. Dragging it moves the strip's
 * group (see `StripEnd`).
 */
export const stripEndOf = (
  bar: Rect,
  strip: StripPlace | undefined,
): Rect | undefined =>
  strip?.rest === undefined || strip.at !== strip.tabs - 1
    ? undefined
    : { ...bar, width: strip.rest, x: bar.x + bar.width };
