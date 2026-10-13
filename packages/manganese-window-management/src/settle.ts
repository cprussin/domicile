// The offset that draws a window part's new box over its old one, so the part
// can take its new box at once and ease into it with `translate` and `scale`.
// See `useSettling`.

import type { Rect } from "./rect";

/** A point in a box, from the box's corner, in desktop pixels. */
export type Point = { x: number; y: number };

/**
 * A part's `scale` and `translate`, applied about its `transform-origin`.
 *
 * The individual properties, not `transform`, so they compose with the
 * window's motion keyframes, which animate `transform`.
 */
export type Offset = {
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
};

/** The offset that draws box `to`, scaled about `origin`, at box `from`. */
export const offsetFrom = (from: Rect, to: Rect, origin: Point): Offset => {
  const scaleX = from.width / to.width;
  const scaleY = from.height / to.height;
  return {
    scaleX,
    scaleY,
    x: from.x - to.x - origin.x * (1 - scaleX),
    y: from.y - to.y - origin.y * (1 - scaleY),
  };
};

/** Where box `rect` is drawn under `offset`, scaled about `origin`. */
export const drawnAt = (rect: Rect, origin: Point, offset: Offset): Rect => ({
  height: rect.height * offset.scaleY,
  width: rect.width * offset.scaleX,
  x: rect.x + origin.x * (1 - offset.scaleX) + offset.x,
  y: rect.y + origin.y * (1 - offset.scaleY) + offset.y,
});

/** The offset `progress` of the way from `from` to no offset. */
export const partway = (from: Offset, progress: number): Offset => ({
  scaleX: from.scaleX + (1 - from.scaleX) * progress,
  scaleY: from.scaleY + (1 - from.scaleY) * progress,
  x: from.x * (1 - progress),
  y: from.y * (1 - progress),
});

/** A step of {@link uprightAlong}: the part's `scale` at progress `at`. */
export type UprightStep = { at: number; scaleX: number; scaleY: number };

/**
 * The `scale` that keeps a part of a settling element at its own size, at
 * `steps` even steps of the settle from `from`.
 *
 * The inverse of a linear ease is not linear, so it is sampled.
 */
export const uprightAlong = (
  from: Offset,
  steps: number,
): readonly UprightStep[] =>
  Array.from({ length: steps + 1 }, (_, step) => {
    const at = step / steps;
    const settled = partway(from, at);
    return { at, scaleX: 1 / settled.scaleX, scaleY: 1 / settled.scaleY };
  });
