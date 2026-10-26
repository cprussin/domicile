// Bluetooth for a React shell: one watch per desktop, however many parts
// read it.

import type { Result } from "@cprussin/option-result";
import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { useDeskWatch } from "@domicile-desktop/react/use-shared-watch";
import { watchPresence } from "@domicile-desktop/react/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";

import type { Bluetooth } from "./bluetooth";
import { watchBluetooth } from "./bluetooth";
import { hasBluetoothHardware } from "./hardware";

/** BlueZ, watched once per desktop. */
export const deskBluetooth = perDesktop(
  (domicile): SharedWatch<Result<Bluetooth, SystemError>> =>
    sharedWatch((onBluetooth) => watchBluetooth(domicile, onBluetooth)),
);

/** Whether the machine has Bluetooth hardware, looked for once per desktop. */
export const deskBluetoothHardware = perDesktop(
  (domicile): SharedWatch<Result<boolean, SystemError>> =>
    sharedWatch((onPresent) =>
      watchPresence(() => hasBluetoothHardware(domicile), onPresent),
    ),
);

/** BlueZ's adapter and devices, or `undefined` before BlueZ says. */
export const useBluetooth = (): Result<Bluetooth, SystemError> | undefined =>
  useDeskWatch(deskBluetooth);

/** Whether the machine has Bluetooth hardware, or `undefined` before it was looked for. */
export const useHasBluetooth = (): Result<boolean, SystemError> | undefined =>
  useDeskWatch(deskBluetoothHardware);
