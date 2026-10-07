import type { Option } from "@cprussin/option-result";
import { None, Some } from "@cprussin/option-result";
import type { Battery as BatteryReading } from "@domicile-desktop/system-battery/battery";
import { act } from "@testing-library/react";

import { sharedWatch } from "../readouts/shared-watch";

/**
 * A test-controlled battery: `battery` replaces the UPower watch, and `report`
 * and `absent` send readings.
 */
export const heldBattery = () => {
  const listeners: ((reading: Option<BatteryReading>) => void)[] = [];
  const watching = { stopped: 0 };
  return {
    absent: () => {
      act(() => {
        for (const onReading of listeners) {
          onReading(None());
        }
      });
    },
    battery: sharedWatch(
      (onReading: (reading: Option<BatteryReading>) => void) => {
        listeners.push(onReading);
        return () => {
          watching.stopped += 1;
        };
      },
    ),
    report: (reading: BatteryReading) => {
      act(() => {
        for (const onReading of listeners) {
          onReading(Some(reading));
        }
      });
    },
    get stopped() {
      return watching.stopped;
    },
  };
};
