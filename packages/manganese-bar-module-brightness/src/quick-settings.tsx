import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { deskBacklight } from "@domicile-desktop/system-backlight/react";

import { BrightnessRow, NightLightTile } from "./BrightnessQuick";
import { deskNightLight } from "./desk-night-light";

/** The desk's brightness slider, for the quick settings panel. */
export const BrightnessLevel = () => (
  <BrightnessRow backlight={deskBacklight(useDomicile())} />
);

/** The desk's night light tile, for the quick settings panel. */
export const NightLight = () => (
  <NightLightTile nightLight={deskNightLight(useDomicile())} />
);
