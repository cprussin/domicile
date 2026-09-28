// A tabbed or stacking container showing a different child.
//
// Both windows are in the same box the whole time: the one hidden is drawn
// under the one shown — see `Frame.behind` — so switching is the two trading
// depths between two frames. What the page draws instead is a crossfade, the
// one revealed fading in over the one it hides.
//
// Like a raise, nothing announces it, so it is read off the difference
// between two renders.

import type { Placement } from "./placement";
import { TILED } from "./placement";
import type { Rect } from "./rect";
import type { Shown } from "./shown";

/** The windows a tab switch has swapped, by id. */
export type TabSwitch = {
  /** Shown a moment ago and behind a tab now. */
  concealed: readonly string[];
  /** Behind a tab a moment ago and shown now. */
  revealed: readonly string[];
};

/**
 * The windows the tabs have swapped since `before`.
 *
 * In pairs: one hidden and one shown in the same box. A window shown with
 * nothing hidden in its place was uncovered by a tab closing, whose contents
 * fade off it — and a window hidden with nothing shown was covered by one
 * opening, which grows in over it.
 *
 * Only tiled ones, because the crossfade holds the pair at the tiled depths
 * while it plays — see `windowRevealing` — and nothing on a workspace switch,
 * which slides the whole screenful.
 */
export const tabSwitched = (before: Shown, shown: Shown): TabSwitch => {
  const concealed = swapped(before, shown, isShown, isHidden);
  const revealed = swapped(before, shown, isHidden, isShown);
  return before.current === shown.current
    ? {
        concealed: concealed
          .filter((hidden) =>
            revealed.some(({ surface }) => sameBox(surface, hidden.behind)),
          )
          .map(({ id }) => id),
        revealed: revealed
          .filter((showing) =>
            concealed.some(({ behind }) => sameBox(behind, showing.surface)),
          )
          .map(({ id }) => id),
      }
    : { concealed: [], revealed: [] };
};

/** The windows that were `was` before and are `now` now, as they are now. */
const swapped = (
  before: Shown,
  shown: Shown,
  was: (placement: Placement) => boolean,
  now: (placement: Placement) => boolean,
): readonly Placement[] =>
  shown.placements.filter((placement) => {
    const then = before.placements.find(({ id }) => id === placement.id);
    return then !== undefined && was(then) && now(placement);
  });

const sameBox = (one: Rect | undefined, other: Rect | undefined): boolean =>
  one !== undefined &&
  other !== undefined &&
  one.x === other.x &&
  one.y === other.y &&
  one.width === other.width &&
  one.height === other.height;

const isShown = (placement: Placement): boolean =>
  placement.surface !== undefined && placement.depth === TILED;

const isHidden = (placement: Placement): boolean =>
  placement.behind !== undefined;
