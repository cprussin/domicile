// Test-only.

import type { Offset } from "./settle";
import type { Settler } from "./useSettling";

/**
 * A settler that finds every element drawn at `current` from its box, and
 * records each offset it is asked to ease from.
 */
export const recordedSettles = (
  current: Offset = { scaleX: 1, scaleY: 1, x: 0, y: 0 },
): { played: (Offset | undefined)[]; settler: Settler } => {
  const played: (Offset | undefined)[] = [];
  return {
    played,
    settler: {
      offset: () => current,
      play: (_, offset) => {
        played.push(offset);
      },
    },
  };
};
