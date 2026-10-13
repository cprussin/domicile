// Keeps the workspace that was just switched away from so it can slide off
// screen. Like `closing.ts`, this is needed because a switch replaces the
// screen state in one reduction.
//
// Also records the direction: workspaces form a row, so incoming windows
// enter from the new workspace's side and outgoing ones leave the other way.

import type { PlacedTab, Placement } from "./placement";
import type { Shown } from "./shown";
import type { Towards } from "./window-motion";
import { WORKSPACES } from "./window-state";

/** A workspace on its way off the screen, with the screenful it had. */
export type WorkspaceSwitch = {
  /** The window that had focus, which its bar keeps showing. */
  activeId: string | undefined;
  placements: readonly Placement[];
  tabs: readonly PlacedTab[];
  towards: Towards;
};

/**
 * Which way the desktop moves going from one workspace to another.
 *
 * Uses the desktop's workspace order, not string order: `10` is last.
 */
export const towardsOf = (before: string, after: string): Towards =>
  orderOf(after) > orderOf(before) ? "end" : "start";

/**
 * The workspace that has just been left, or `undefined` when none has.
 *
 * Returns `undefined` when both workspaces are empty. A switch ends when an
 * animation on screen ends, so with nothing on screen it would never end and
 * the next window would slide in as if from another workspace.
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

/** A workspace's position in the row. Throws for an unknown workspace. */
const orderOf = (name: string): number => {
  const at = WORKSPACES.indexOf(name);
  if (at === -1) {
    throw new Error(`shell: no workspace ${name} to switch to or from`);
  } else {
    return at;
  }
};
