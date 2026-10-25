import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { Brightness as Level } from "./Brightness";
import { deskBacklight, deskBacklightHardware } from "./desk-backlight";
import { deskNightLight } from "./desk-night-light";

/** The screen brightness and the night light. */
export const Brightness = () => {
  const domicile = useDomicile();
  return (
    <Level
      backlight={deskBacklight(domicile)}
      hardware={deskBacklightHardware(domicile)}
      nightLight={deskNightLight(domicile)}
    />
  );
};
