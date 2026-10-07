import type { ShotRect } from "@domicile-desktop/sdk/portal";

/** A pixel of a frozen desk's frame. */
export type FramePoint = { x: number; y: number };

/**
 * The frame pixel under `client`, a point on the page, when the frame is drawn
 * over `box`. A point off the drawn frame is kept on its edge.
 */
export const framePoint = (
  client: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
): FramePoint => ({
  x: along(client.x - box.left, box.width, frame.width),
  y: along(client.y - box.top, box.height, frame.height),
});

/** The area a drag from `from` to `to` covers, both pixels included. */
export const draggedArea = (from: FramePoint, to: FramePoint): ShotRect => ({
  height: Math.abs(to.y - from.y) + 1,
  width: Math.abs(to.x - from.x) + 1,
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
});

/** The frame pixel `offset` of `drawn` page pixels into `pixels`. */
const along = (offset: number, drawn: number, pixels: number): number =>
  Math.min(pixels - 1, Math.max(0, Math.floor((offset / drawn) * pixels)));
