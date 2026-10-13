import type { Option } from "@cprussin/option-result";
import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import type { Battery } from "@domicile-desktop/system-battery/battery";
import { watchBattery } from "./watch-battery";

/** The battery, watched once for every bar and the lock screen. */
export const deskBattery = perHost(
  (domicile): SharedWatch<Option<Battery>> =>
    sharedWatch((onReading) => watchBattery(domicile, onReading)),
);
