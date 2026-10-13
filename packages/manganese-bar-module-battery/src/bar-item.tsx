import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { Battery as Charge } from "./Battery";
import { deskBattery } from "./desk-battery";

/** The battery charge. */
export const Battery = () => <Charge battery={deskBattery(useDomicile())} />;
