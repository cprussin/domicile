import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { Brightness as Level } from "./Brightness";
import { deskBacklight } from "./desk-backlight";

/** The screen brightness. */
export const Brightness = () => (
  <Level backlight={deskBacklight(useDomicile())} />
);
