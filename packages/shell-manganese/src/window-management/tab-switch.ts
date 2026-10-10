// Detects a tabbed or stacking container switching its shown child, so the
// page can crossfade, or showing the next child after a close.
//
// A hidden tab keeps the shown one's box (see `Frame.behind`), which pairs the
// two tabs of a switch. No event announces it, so this compares two renders.

import type { Placement } from "./placement";
import { TILED } from "./placement";
import type { Rect } from "./rect";
import type { Shown } from "./shown";

/** The windows a tab switch has swapped, by id. */
export type TabSwitch = {
  /**
   * Shown before, hidden now under a window revealed or arrived in its box.
   * Drawn under that window until it is in.
   */
  concealed: readonly string[];
  /** Hidden before, shown now. */
  revealed: readonly string[];
  /**
   * Hidden before, shown now with no window hidden in its place, as after a
   * close.
   */
  uncovered: readonly string[];
};

/**
 * The windows tabs swapped since `before`.
 *
 * Only pairs count as a switch: one hidden and one shown in the same box. A
 * window shown unpaired is uncovered, as when the tab over it closes. A tab
 * hidden by a window new to the screen, such as a tab just opened, is
 * concealed too, though that window is not revealed.
 *
 * Tiled windows only, since the crossfade holds the pair at tiled depths (see
 * `windowHeldTiled`). Workspace switches are skipped.
 */
export const tabSwitched = (before: Shown, shown: Shown): TabSwitch => {
  const concealed = swapped(before, shown, isShown, isHidden);
  const revealed = swapped(before, shown, isHidden, isShown);
  const arrived = shown.placements.filter(
    (placement) =>
      isShown(placement) &&
      !before.placements.some(
        (then) => then.id === placement.id && isShown(then),
      ),
  );
  return before.current === shown.current
    ? {
        concealed: concealed
          .filter((hidden) =>
            arrived.some(({ surface }) => sameBox(surface, hidden.behind)),
          )
          .map(({ id }) => id),
        revealed: revealed
          .filter((showing) => paired(concealed, showing))
          .map(({ id }) => id),
        uncovered: revealed
          .filter((showing) => !paired(concealed, showing))
          .map(({ id }) => id),
      }
    : { concealed: [], revealed: [], uncovered: [] };
};

/** Current placements of windows that matched `was` before and `now` now. */
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

/** Whether a window was hidden in the box `showing` is now shown in. */
const paired = (concealed: readonly Placement[], showing: Placement): boolean =>
  concealed.some(({ behind }) => sameBox(behind, showing.surface));

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
