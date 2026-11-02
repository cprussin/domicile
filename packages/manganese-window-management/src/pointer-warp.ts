// Decides where to warp the pointer after the desktop moves focus, like sway's
// `mouse_warping`.
//
// The rule: the pointer moves only when it will not be over the newly focused
// window once the layout settles. Every focus change `usePointerWarp` answers
// goes through `warpTo`, which applies it. See
// packages/manganese-window-management/docs/WINDOW-MANAGEMENT.md#pointer-warping.

import type { Rect } from "./rect";

/**
 * A point in page pixels, which equal desktop pixels; the engine transforms
 * each monitor's window, not the page.
 */
export type Spot = readonly [x: number, y: number];

/** The focused window or empty screen, where the layout puts it. */
export type Focus = {
  /** Its contents, whose middle the pointer warps to. */
  box: Rect;
  /**
   * The whole window, title bar included: the pointer anywhere in it is on the
   * window. The layout's final place, not where an animation has it now.
   */
  frame: Rect;
  /** The window, or `undefined` for an empty screen. */
  id: string | undefined;
};

/** A window the screen shows, and its box. */
export type Shown = {
  box: Rect;
  id: string;
};

type Move = {
  /** The focus before the key press. */
  from: Focus | undefined;
  /** Where the page last saw the pointer, if ever. */
  pointer: Spot | undefined;
  /** The focus now. */
  to: Focus | undefined;
};

/**
 * Where to warp the pointer, or `undefined` to leave it.
 *
 * Warps only when the focus changed window or box (as `mod+shift+h` does) and
 * the pointer will not be over the new window's frame. A window that slides in
 * under the pointer, such as a neighbor filling a closed window's space, keeps
 * it where it is. Other keys, such as a split or the launcher, must not move
 * the cursor.
 */
export const warpTo = ({ from, pointer, to }: Move): Spot | undefined =>
  to === undefined || settled(from, to) || holds(to.frame, pointer)
    ? undefined
    : middleOf(to.box);

/**
 * Whether the pointer is over a shown window other than `focus`.
 *
 * A window that opens only needs the pointer if another window would take
 * focus from it. Over the top bar or an empty screen, nothing would.
 */
export const overAnother = (
  shown: readonly Shown[],
  focus: Focus | undefined,
  pointer: Spot | undefined,
): boolean =>
  shown.some(({ box, id }) => id !== focus?.id && holds(box, pointer));

/** Whether the focus stayed on the same window in the same box. */
const settled = (from: Focus | undefined, to: Focus): boolean =>
  from !== undefined &&
  from.id === to.id &&
  from.box.x === to.box.x &&
  from.box.y === to.box.y &&
  from.box.width === to.box.width &&
  from.box.height === to.box.height;

/**
 * Whether the pointer is over `box`.
 *
 * An unknown pointer counts as outside, so the warp happens and focus cannot
 * bounce back.
 */
const holds = (box: Rect, pointer: Spot | undefined): boolean =>
  pointer !== undefined &&
  pointer[0] >= box.x &&
  pointer[0] <= box.x + box.width &&
  pointer[1] >= box.y &&
  pointer[1] <= box.y + box.height;

/**
 * The middle of `box`, rounded to a whole pixel.
 *
 * The engine rounds warps with `base::ClampRound`, and the page must recognize
 * its own warp when it arrives. See `usePointerWarp`.
 */
const middleOf = (box: Rect): Spot => [
  Math.round(box.x + box.width / 2),
  Math.round(box.y + box.height / 2),
];
