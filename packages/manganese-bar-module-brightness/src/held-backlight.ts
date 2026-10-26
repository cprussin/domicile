import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import type { SharedBacklight } from "@domicile-desktop/system-backlight/shared-backlight";
import { act } from "@testing-library/react";

/**
 * A test-controlled backlight: `backlight` replaces the system's, `report`
 * sends a level, and `asked` records every level the shell requested.
 */
export const heldBacklight = () => {
  const listeners: ((level: number) => void)[] = [];
  const asked: number[] = [];
  const backlight: SharedBacklight = {
    adjust: (level) => {
      asked.push(level);
    },
    chosen: () => () => undefined,
    level: sharedWatch((onLevel: (level: number) => void) => {
      listeners.push(onLevel);
      return () => undefined;
    }),
    set: (level) => {
      asked.push(level);
    },
  };
  return {
    asked,
    backlight,
    report: (level: number) => {
      act(() => {
        for (const onLevel of listeners) {
          onLevel(level);
        }
      });
    },
  };
};
