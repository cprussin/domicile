import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { Battery as Charge } from "./Battery";
import { deskBattery, deskBatteryHardware } from "./desk-battery";

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
