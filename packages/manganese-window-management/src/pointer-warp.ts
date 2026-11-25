// Decides where to warp the pointer after the desktop moves focus, like sway's
// `mouse_warping`.
//
// The rule: the pointer moves only when the focus changed and the pointer is
// over another window once the layout settles, which would take focus back.
// Over the top bar or an empty screen it stays put. Every focus change
// `usePointerWarp` answers goes through `warpTo`, which hands the engine the
// frames to check: the page cannot see the pointer move over a browser
// window's page, so the engine, which can, makes the check. See
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

/** A window the screen shows, and its frame: just its tab, if hidden. */
export type Shown = {
  box: Rect;
  id: string;
};

type Move = {
  /** The focus before the key press. */
  from: Focus | undefined;
  /** Every window the screens show, in the new layout. */
  shown: readonly Shown[];
  /** The focus now. */
  to: Focus | undefined;
};

/** A warp to ask the engine for. */
export type Warp = {
  /** The boxes the pointer moves from: every other shown window's. */
  onlyOver: readonly Rect[];
  /** Where the pointer goes. */
  to: Spot;
  /** The box the pointer stays put over: the new window's frame. */
  unlessOver: Rect;
};

/**
 * The warp to ask for, or `undefined` to leave the pointer.
 *
 * Asks only when the focus changed window or box (as `mod+shift+h` does), and
 * only for a pointer over another shown window and outside the new window's
 * frame. A window that slides in under the pointer, such as a neighbor filling
 * a closed window's space, keeps it where it is; so does a tab switch with the
 * pointer over the top bar. Other keys, such as a split or the launcher, must
 * not move the cursor.
 */
export const warpTo = ({ from, shown, to }: Move): Warp | undefined => {
  const others = shown.flatMap(({ box, id }) => (id === to?.id ? [] : [box]));
  return to === undefined || settled(from, to) || others.length === 0
    ? undefined
    : { onlyOver: others, to: middleOf(to.box), unlessOver: to.frame };
};

/** Whether the focus stayed on the same window in the same box. */
const settled = (from: Focus | undefined, to: Focus): boolean =>
  from !== undefined &&
  from.id === to.id &&
  from.box.x === to.box.x &&
  from.box.y === to.box.y &&
  from.box.width === to.box.width &&
  from.box.height === to.box.height;

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
