import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Bluetooth as Reading } from "@domicile-desktop/system-bluetooth/bluetooth";
import { act } from "@testing-library/react";

/**
 * A test-controlled BlueZ: `bluetooth` replaces the library's watch, and
 * `report` sends what it would.
 */
export const heldBluetooth = () => {
  const listeners: ((bluetooth: Result<Reading, SystemError>) => void)[] = [];
  const watching = { stopped: 0 };
  return {
    bluetooth: sharedWatch(
      (onBluetooth: (bluetooth: Result<Reading, SystemError>) => void) => {
        listeners.push(onBluetooth);
        return () => {
          watching.stopped += 1;
        };
      },
    ),
    report: (bluetooth: Result<Reading, SystemError>) => {
      act(() => {
        for (const onBluetooth of listeners) {
          onBluetooth(bluetooth);
        }
      });
    },
    get stopped() {
      return watching.stopped;
    },
  };
};

/** A test-controlled check for Bluetooth hardware. */
export const heldHardware = () => {
  const listeners: ((present: Result<boolean, SystemError>) => void)[] = [];
  return {
    hardware: sharedWatch(
      (onPresent: (present: Result<boolean, SystemError>) => void) => {
        listeners.push(onPresent);
        return () => undefined;
      },
    ),
    report: (present: Result<boolean, SystemError>) => {
      act(() => {
        for (const onPresent of listeners) {
          onPresent(present);
        }
      });
    },
  };
};

export const ADAPTER = "/org/bluez/hci0";

/** `batteries` holds the charge of the connected devices that report one. */
export const reading = (
  powered: boolean,
  connected: string[],
  batteries: Record<string, number> = {},
) =>
  Ok<Reading, SystemError>({
    adapters: [{ discovering: false, path: ADAPTER, powered }],
    devices: [
      ...connected.map((name, index) => ({
        adapter: ADAPTER,
        address: `AC:80:0A:1B:2C:3${index}`,
        battery: batteries[name],
        connected: true,
        name,
        paired: true,
        path: `${ADAPTER}/dev_${index}`,
      })),
      {
        adapter: ADAPTER,
        address: "F4:73:35:4E:5F:60",
        battery: undefined,
        connected: false,
        name: "MX Master 3",
        paired: true,
        path: `${ADAPTER}/dev_mouse`,
      },
    ],
  });
