// The workspace that has just left the screen, while it is still leaving.
//
// The other half of `closing.ts`, and for the same reason: switching workspace
// replaces what is on screen in one reduction, so the workspace that was there
// is not anywhere to be drawn from. What is kept here is the screenful it
// had — where its windows were, the tabs over them, and which of them the
// keyboard was in — so that it can slide off rather than blink out.
//
// **And which way it goes.** A workspace switch is the one change on this
// desktop with a direction: the workspaces are a row, and going from 2 to 3 is
// not the same movement as going from 2 to 1. The windows arriving come in
// from the side the new workspace was on and the ones leaving go the other
// way, so the two pass each other.

import type { Placement } from "./placement";
import type { Shown } from "./shown";
import type { Tab } from "./tree/frames";
import type { Towards } from "./window-motion";
import { WORKSPACES } from "./window-state";

/** A workspace on its way off the screen, with the screenful it had. */
export type WorkspaceSwitch = {
  /** The window the keyboard was in, which its bar goes on saying. */
  activeId: string | undefined;
  placements: readonly Placement[];
  tabs: readonly Tab[];
  towards: Towards;
};

/**
 * Which way the desktop moves going from one workspace to another.
 *
 * In the order the desktop names them rather than the order their names sort
 * in, which are not the same order: `10` is the last workspace and `"10"` is
 * the second string.
 */
export const towardsOf = (before: string, after: string): Towards =>
  orderOf(after) > orderOf(before) ? "end" : "start";

/**
 * The workspace that has just been left, or `undefined` when none has.
 *
 * Nothing is kept for a switch between two workspaces with nothing on either
 * of them. A switch is over when something on screen says its animation has
 * ended, and there is nothing there to say so — so one recorded would be one
 * that never finished, and the next window to open would slide in as though it
 * had been on another workspace all along.
 */
export const switchedTo = (
  before: Shown,
  after: Shown,
): WorkspaceSwitch | undefined => {
  const empty =
    before.placements.length === 0 &&
    before.tabs.length === 0 &&
    after.placements.length === 0 &&
    after.tabs.length === 0;
  if (before.current === after.current || empty) {
    return undefined;
  } else {
    return {
      activeId: before.activeId,
      placements: before.placements,
      tabs: before.tabs,
      towards: towardsOf(before.current, after.current),
    };
  }
};

/** Where a workspace comes in the row. Throws for one the desktop has not got. */
const orderOf = (name: string): number => {
  const at = WORKSPACES.indexOf(name);
  if (at === -1) {
    throw new Error(`shell: no workspace ${name} to switch to or from`);
  } else {
    return at;
  }
};
