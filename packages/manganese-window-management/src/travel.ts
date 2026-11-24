// Where a window travels as it opens or leaves: from the window that opened
// it, or into its workspace's chip in the bar.

import type { Rect } from "./rect";

/**
 * Marks a workspace's chip in the bar with the workspace's name. A window sent
 * to the workspace flies into it.
 */
export const WORKSPACE_CHIP = "data-workspace-chip";

/**
 * How far a window's middle travels, and the scale it travels to, or
 * `undefined` to keep its motion's own.
 */
export type Travel = { scale: number | undefined; x: number; y: number };

/**
 * The travel that moves `frame`'s middle onto `target`'s, `sized` to fit
 * inside it if asked. A window's parts scale about its frame's middle (see
 * `scaledAbout`), so each part travels the same way.
 */
export const travelTo = (
  frame: Rect,
  target: Rect,
  sized: boolean,
): Travel => ({
  scale: sized
    ? Math.min(target.width / frame.width, target.height / frame.height)
    : undefined,
  x: middleOf(target.x, target.width) - middleOf(frame.x, frame.width),
  y: middleOf(target.y, target.height) - middleOf(frame.y, frame.height),
});

const middleOf = (start: number, length: number): number => start + length / 2;

/**
 * Inline style giving a window's parts its travel, which the opening and
 * sending keyframes read. None for `undefined`, so they grow or shrink in
 * place.
 */
export const traveled = (
  travel: Travel | undefined,
): Record<`--${string}`, number | string> =>
  travel === undefined
    ? {}
    : {
        ...(travel.scale === undefined
          ? {}
          : { "--travel-scale": travel.scale }),
        "--travel-x": `${travel.x.toString()}px`,
        "--travel-y": `${travel.y.toString()}px`,
      };

/** The chip of workspace `name` in the bar, or `undefined` if none shows it. */
export const chipFor = (name: string): Element | undefined =>
  // Compared rather than selected, since a name may hold any character.
  [...document.querySelectorAll(`[${WORKSPACE_CHIP}]`)].find(
    (chip) => chip.getAttribute(WORKSPACE_CHIP) === name,
  );
