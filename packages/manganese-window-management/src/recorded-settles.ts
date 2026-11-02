// Test-only.

import type { Offset } from "./settle";
import type { Settler } from "./useSettling";

/**
 * A settler that finds every element drawn at `current` from its box, and
 * records each offset it is asked to ease from, the parts it keeps upright,
 * and how to end each settle.
 */
export const recordedSettles = (
  current: Offset = { scaleX: 1, scaleY: 1, x: 0, y: 0 },
): {
  ends: (() => void)[];
  kept: (readonly Element[])[];
  played: (Offset | undefined)[];
  settler: Settler;
} => {
  const ends: (() => void)[] = [];
  const kept: (readonly Element[])[] = [];
  const played: (Offset | undefined)[] = [];
  return {
    ends,
    kept,
    played,
    settler: {
      offset: () => current,
      play: (_, offset, upright, onEnded) => {
        ends.push(onEnded);
        kept.push(upright);
        played.push(offset);
      },
    },
  };
};
