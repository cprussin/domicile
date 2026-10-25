import type { Option, Result } from "@cprussin/option-result";
import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { watchPresence } from "@domicile-desktop/manganese-host/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Battery } from "@domicile-desktop/system-battery/battery";
import { hasBattery } from "@domicile-desktop/system-battery/hardware";
import { watchBattery } from "./watch-battery";

/** The battery, watched once for every bar and the lock screen. */
export const deskBattery = perHost(
  (domicile): SharedWatch<Option<Battery>> =>
    sharedWatch((onReading) => watchBattery(domicile, onReading)),
);

/** Whether the machine has a battery, looked for once for every bar and the lock screen. */
export const deskBatteryHardware = perHost(
  (domicile): SharedWatch<Result<boolean, SystemError>> =>
    sharedWatch((onPresent) =>
      watchPresence(() => hasBattery(domicile), onPresent),
    ),
);
