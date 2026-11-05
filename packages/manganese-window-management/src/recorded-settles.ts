// Test-only.

import type { Offset } from "./settle";
import type { Settler } from "./useSettling";

/**
 * A settler that finds every element drawn at `current` from its box, and
 * records each offset it is asked to ease from, the parts it keeps upright,
 * the depth it holds, and how to end each settle.
 */
export const recordedSettles = (
  current: Offset = { scaleX: 1, scaleY: 1, x: 0, y: 0 },
): {
  ends: (() => void)[];
  held: (number | undefined)[];
  kept: (readonly Element[])[];
  played: (Offset | undefined)[];
  settler: Settler;
} => {
  const ends: (() => void)[] = [];
  const held: (number | undefined)[] = [];
  const kept: (readonly Element[])[] = [];
  const played: (Offset | undefined)[] = [];
  return {
    ends,
    held,
    kept,
    played,
    settler: {
      offset: () => current,
      play: (_, offset, upright, over, onEnded) => {
        ends.push(onEnded);
        held.push(over);
        kept.push(upright);
        played.push(offset);
      },
    },
  };
};
