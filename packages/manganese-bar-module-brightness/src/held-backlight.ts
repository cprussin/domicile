import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { act } from "@testing-library/react";
import type { SharedBacklight } from "./shared-backlight";

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
