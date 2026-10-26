import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import {
  deskBacklight,
  deskBacklightHardware,
} from "@domicile-desktop/system-backlight/react";
import { Brightness as Level } from "./Brightness";
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
