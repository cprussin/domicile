// Where the pointer goes when the keyboard moves the focus, and when it stays.
//
// sway's `mouse_warping`, and this desktop needs it for sway's own reason:
// focus follows the cursor here, so a keyed focus change that left the pointer
// where it was would be handed straight back. `mod+l` moves the focus right,
// the window that was on the right slides under the stationary pointer, and
// the `pointerover` that fires as it arrives focuses it again — the press
// undone by the layout it caused.
//
// The decision only. What a page can do about it is `usePointerWarp`, which is
// the one caller.

import type { Rect } from "./rect";

/**
 * A place on the desktop, in the page's own pixels — which are the desktop's:
 * the engine turns and scales a monitor's window, not the page.
 */
export type Spot = readonly [x: number, y: number];

/** The window the keyboard is in, and the box it is drawn in. */
export type Focus = {
  box: Rect;
  id: string;
};

type Move = {
  /** Where the keyboard was before the press. */
  from: Focus | undefined;
  /** Where the page last saw the pointer, or nothing if it never has. */
  pointer: Spot | undefined;
  /** Where it is now. */
  to: Focus | undefined;
};

/**
 * Where the pointer has to be for the focus to stay where it was put, or
 * `undefined` for a press that leaves it where it is.
 *
 * Two questions, and both have to answer yes. **Did the keyboard move** — a
 * different window, or the same window in a different box, which is what
 * `mod+shift+h` does. And **is the pointer somewhere else**: a window arriving
 * under the pointer it was already under can take no focus away from itself,
 * and neither can a tab of the container the pointer is over. Warping anyway
 * would move the cursor on keys that have nothing to do with where it is —
 * a split, a layout, the launcher — which is a desktop that fidgets.
 */
export const warpTo = ({ from, pointer, to }: Move): Spot | undefined =>
  to === undefined || settled(from, to) || holds(to.box, pointer)
    ? undefined
    : middleOf(to.box);

/** Whether the press left the keyboard in the same window in the same place. */
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
 * A pointer the page has never seen is over nothing: the engine has drawn it
 * somewhere and said nothing about where, and guessing it is over the window
 * is the guess that leaves the focus able to bounce.
 */
const holds = (box: Rect, pointer: Spot | undefined): boolean =>
  pointer !== undefined &&
  pointer[0] >= box.x &&
  pointer[0] <= box.x + box.width &&
  pointer[1] >= box.y &&
  pointer[1] <= box.y + box.height;

/**
 * The middle of `box`, at a whole pixel.
 *
 * Rounded here rather than left to the engine, which rounds it anyway:
 * `PointerWarpTarget` pins the spot with `base::ClampRound`, so a fraction
 * asked for comes back as the pixel next to it — and the page has to be able
 * to recognize its own warp arriving. See `usePointerWarp`.
 */
const middleOf = (box: Rect): Spot => [
  Math.round(box.x + box.width / 2),
  Math.round(box.y + box.height / 2),
];
