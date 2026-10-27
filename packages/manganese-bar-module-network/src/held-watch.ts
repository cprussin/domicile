import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { act } from "@testing-library/react";

/**
 * A test-controlled watch: `watch` replaces the library's, and `report` sends
 * what it would.
 */
export const held = <T>() => {
  const listeners: ((value: T) => void)[] = [];
  const watching = { started: 0, stopped: 0 };
  return {
    report: (value: T) => {
      act(() => {
        for (const onValue of listeners) {
          onValue(value);
        }
      });
    },
    get started() {
      return watching.started;
    },
    get stopped() {
      return watching.stopped;
    },
    watch: sharedWatch((onValue: (value: T) => void) => {
      watching.started += 1;
      listeners.push(onValue);
      return () => {
        watching.stopped += 1;
      };
    }),
  };
};
