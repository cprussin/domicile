import { z } from "zod";

/**
 * An Electron window's shape as the engine lists it (`win.setShape`): the
 * boxes, in CSS pixels from its page's top left, it draws and takes input
 * within.
 */
const shapeSchema = z
  .array(
    z.object({
      height: z.number().int().nonnegative(),
      width: z.number().int().nonnegative(),
      x: z.number().int(),
      y: z.number().int(),
    }),
  )
  .min(1);

/**
 * The `clip-path` that draws a page only within `shape`, the engine's JSON
 * for an Electron window's shape: the boxes' union, each a path the same way
 * round so overlaps stay in. A window with no shape lists none, not an empty
 * one, as Electron's empty shape is the whole window.
 */
export const shapeClipPath = (shape: string): string => {
  const boxes = shapeSchema
    .parse(JSON.parse(shape))
    .map(
      ({ height, width, x, y }) =>
        `M${x.toString()} ${y.toString()}h${width.toString()}v${height.toString()}h${(-width).toString()}Z`,
    );
  return `path("${boxes.join("")}")`;
};
