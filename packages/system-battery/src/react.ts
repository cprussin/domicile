// The battery for a React shell: one watch per desktop, however many parts
// read it.

import type { Option, Result } from "@cprussin/option-result";
import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { useDeskWatch } from "@domicile-desktop/react/use-shared-watch";
import { watchPresence } from "@domicile-desktop/react/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";

import type { Battery } from "./battery";
import { followBattery } from "./follow-battery";
import { hasBattery } from "./hardware";

/** The battery, watched once per desktop. */
export const deskBattery = perDesktop(
  (domicile): SharedWatch<Option<Battery>> =>
    sharedWatch((onReading) => followBattery(domicile, onReading)),
);

/** Whether the machine has a battery, looked for once per desktop. */
export const deskBatteryHardware = perDesktop(
  (domicile): SharedWatch<Result<boolean, SystemError>> =>
    sharedWatch((onPresent) =>
      watchPresence(() => hasBattery(domicile), onPresent),
    ),
);

/** The battery's reading: `None()` without one, `undefined` before UPower says. */
export const useBattery = (): Option<Battery> | undefined =>
  useDeskWatch(deskBattery);

/** Whether the machine has a battery, or `undefined` before it was looked for. */
export const useHasBattery = (): Result<boolean, SystemError> | undefined =>
  useDeskWatch(deskBatteryHardware);
