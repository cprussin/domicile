// Where a window sits, and where a new one opens.

/** How far each window opens down and to the right of the one before it. */
const CASCADE_STEP = 32;

/** How many windows the cascade runs for before starting over. */
const CASCADE_LENGTH = 8;

/**
 * Where a window sits on the desktop, in the CSS pixels the chrome lays out in.
 *
 * Physical rather than logical (`left`/`top`, not `insetInlineStart`): these are
 * screen coordinates a pointer is dragged through, and a pointer does not
 * change direction with the writing mode.
 */
export type WindowBox = {
  height: number;
  left: number;
  top: number;
  width: number;
};

/**
 * Where the `index`th window to appear opens, at the size its client asked for.
 *
 * A Wayland client says how big it wants to be and nothing about where —
 * `app_appeared` carries a size and no position, because placing a window is
 * the desktop's job. This does the crudest thing that stays usable: a step down
 * and right of the window before it, wrapping so a long session does not walk
 * them off the bottom right corner.
 */
export const openingBox = (
  index: number,
  [width, height]: readonly [number, number],
): WindowBox => {
  const step = CASCADE_STEP * (index % CASCADE_LENGTH);
  return { height, left: step, top: step, width };
};
