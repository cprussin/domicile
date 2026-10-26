import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import {
  deskBattery,
  deskBatteryHardware,
} from "@domicile-desktop/system-battery/react";
import { Battery as Charge } from "./Battery";

/** The battery charge. */
export const Battery = () => {
  const domicile = useDomicile();
  return (
    <Charge
      battery={deskBattery(domicile)}
      hardware={deskBatteryHardware(domicile)}
    />
  );
};
