import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { deskBattery } from "@domicile-desktop/system-battery/react";

import { BatteryStatus } from "./BatteryStatus";

/** The desk's battery in words, for the quick settings panel. */
export const BatteryCharge = () => (
  <BatteryStatus battery={deskBattery(useDomicile())} />
);
