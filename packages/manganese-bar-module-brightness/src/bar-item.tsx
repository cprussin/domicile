import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { Brightness as Level } from "./Brightness";
import { deskBacklight, deskBacklightHardware } from "./desk-backlight";

/** The screen brightness. */
export const Brightness = () => {
  const domicile = useDomicile();
  return (
    <Level
      backlight={deskBacklight(domicile)}
      hardware={deskBacklightHardware(domicile)}
    />
  );
};
