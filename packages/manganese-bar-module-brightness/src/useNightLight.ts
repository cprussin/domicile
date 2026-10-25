import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { useEffect } from "react";

import { deskNightLight } from "./desk-night-light";
import type { NightLightOptions } from "./night-light-options";
import { nightLightSettings } from "./night-light-options";

/**
 * Runs the desk's night light by `options` while mounted. Mount it once, on
 * the desktop's page; bars read and toggle it with {@link deskNightLight}.
 */
export const useNightLight = (
  domicile: DomicileHost,
  { from, schedule, to, warmth }: NightLightOptions,
  zone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): void => {
  const light = deskNightLight(domicile);
  useEffect(
    () => light.run(nightLightSettings({ from, schedule, to, warmth }, zone)),
    [from, light, schedule, to, warmth, zone],
  );
};
