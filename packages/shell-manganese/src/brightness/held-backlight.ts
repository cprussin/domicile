import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act } from "@testing-library/react";

/**
 * A test-controlled backlight: `backlight` replaces the system's, `report`
 * sends a level, and `asked` records every level the shell requested.
 */
export const heldBacklight = () => {
  const listeners: ((level: number) => void)[] = [];
  const asked: number[] = [];
  return {
    asked,
    backlight: () => ({
      set: (level: number) => {
        asked.push(level);
      },
      watch: (onLevel: (level: number) => void) => {
        listeners.push(onLevel);
        return () => undefined;
      },
    }),
    domicile: new FakeDomicileHost().host,
    report: (level: number) => {
      act(() => {
        for (const onLevel of listeners) {
          onLevel(level);
        }
      });
    },
  };
};
