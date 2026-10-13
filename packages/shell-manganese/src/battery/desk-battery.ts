import type { Option } from "@cprussin/option-result";
import type { Battery } from "@domicile-desktop/system-battery/battery";

import { perHost } from "../host/per-host";
import type { SharedWatch } from "../readouts/shared-watch";
import { sharedWatch } from "../readouts/shared-watch";
import { watchBattery } from "./watch-battery";

/** The battery, watched once for every bar and the lock screen. */
export const deskBattery = perHost(
  (domicile): SharedWatch<Option<Battery>> =>
    sharedWatch((onReading) => watchBattery(domicile, onReading)),
);
