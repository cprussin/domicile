import { useEffect, useMemo } from "react";

import type { SharedBacklight } from "./desk-backlight";

/** How far one press moves the brightness. Matches the wheel over the bar's icon. */
const STEP = 0.05;

/** What the brightness keys do. */
export type BrightnessKeys = {
  up: () => void;
  down: () => void;
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
      if (now !== undefined) {
        set(Math.min(1, Math.max(0, Math.round((now + by) * 100) / 100)));
      }
    };
    return {
      down: () => {
        step(-STEP);
      },
      up: () => {
        step(STEP);
      },
    };
  }, [level, set]);
};
