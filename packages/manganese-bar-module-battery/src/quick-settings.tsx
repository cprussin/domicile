import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import {
  deskBattery,
  deskBatteryHardware,
} from "@domicile-desktop/system-battery/react";

import { Battery } from "./Battery";
import { BatteryStatus } from "./BatteryStatus";

/** The desk's battery charge, for the quick settings button. */
export const BatteryIndicator = () => {
  const domicile = useDomicile();
  return (
    <Battery
      battery={deskBattery(domicile)}
      fitted
      hardware={deskBatteryHardware(domicile)}
    />
  );
};

/** The desk's battery in words, for the quick settings panel. */
export const BatteryCharge = () => (
  <BatteryStatus battery={deskBattery(useDomicile())} />
);
