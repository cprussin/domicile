// Test-only.

import type { Offset } from "./settle";
import type { Settler } from "./useSettling";

/**
 * A settler that finds every element drawn at `current` from its box, and
 * records each offset it is asked to ease from and the parts it keeps
 * upright.
 */
export const recordedSettles = (
  current: Offset = { scaleX: 1, scaleY: 1, x: 0, y: 0 },
): {
  kept: (readonly Element[])[];
  played: (Offset | undefined)[];
  settler: Settler;
} => {
  const kept: (readonly Element[])[] = [];
  const played: (Offset | undefined)[] = [];
  return {
    kept,
    played,
    settler: {
      offset: () => current,
      play: (_, offset, upright) => {
        kept.push(upright);
        played.push(offset);
      },
    },
  };
};
