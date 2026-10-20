import { useEffect, useMemo } from "react";

import type { SharedBacklight } from "./desk-backlight";

/** How far one press moves the brightness. Matches the wheel over the bar's icon. */
const STEP = 0.05;

/**
 * What the brightness keys do. Each returns the level it asked for, or
 * `undefined` when it did nothing.
 */
export type BrightnessKeys = {
  up: () => number | undefined;
  down: () => number | undefined;
};

/**
 * The brightness keys.
 *
 * Holds the backlight's watch while mounted, so a press reads the latest level
 * even when no bar shows the brightness. A press does nothing without a
 * backlight.
 */
export const useBrightnessKeys = ({
  level,
  set,
}: SharedBacklight): BrightnessKeys => {
  useEffect(() => level.subscribe(() => undefined), [level]);

  return useMemo(() => {
    const step = (by: number) => {
      const now = level.current();
      if (now === undefined) {
        return undefined;
      } else {
        const next = Math.min(
          1,
          Math.max(0, Math.round((now + by) * 100) / 100),
        );
        set(next);
        return next;
      }
    };
    return {
      down: () => step(-STEP),
      up: () => step(STEP),
    };
  }, [level, set]);
};
