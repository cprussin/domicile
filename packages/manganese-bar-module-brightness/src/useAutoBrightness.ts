import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { useEffect } from "react";

import { runAutoBrightness } from "./auto-brightness";
import { deskBacklight } from "./desk-backlight";
import type { AmbientLight } from "./host-ambient-light";
import { hostAmbientLight } from "./host-ambient-light";

/**
 * Automatic brightness for the desk while mounted and `enabled`. See
 * {@link runAutoBrightness}. Mount it once, on the desktop's page.
 */
export const useAutoBrightness = (
  domicile: DomicileHost,
  enabled: boolean,
  light?: AmbientLight,
): void => {
  const backlight = deskBacklight(domicile);
  useEffect(
    () =>
      enabled
        ? runAutoBrightness(backlight, light ?? hostAmbientLight(domicile))
        : undefined,
    [backlight, domicile, enabled, light],
  );
};
