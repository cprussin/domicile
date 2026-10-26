// The backlight for a React shell: one watch per desktop, however many parts
// read it, and automatic brightness.

import type { Result } from "@cprussin/option-result";
import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { useDeskWatch } from "@domicile-desktop/react/use-shared-watch";
import { watchPresence } from "@domicile-desktop/react/watch-presence";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { useEffect } from "react";

import { runAutoBrightness } from "./auto-brightness";
import type { AmbientLight } from "./host-ambient-light";
import { hostAmbientLight } from "./host-ambient-light";
import { hostBacklight } from "./host-backlight";
import { readBacklight } from "./read-backlight";
import type { SharedBacklight } from "./shared-backlight";
import { sharedBacklight } from "./shared-backlight";

/** The backlight, watched once per desktop. */
export const deskBacklight = perDesktop(
  (domicile): SharedBacklight => sharedBacklight(hostBacklight(domicile)),
);

/** Whether the machine has a backlight, looked for once per desktop. */
export const deskBacklightHardware = perDesktop(
  (domicile): SharedWatch<Result<boolean, SystemError>> =>
    sharedWatch((onPresent) =>
      watchPresence(
        async () =>
          (await readBacklight(domicile)).map((found) => found.isSome()),
        onPresent,
      ),
    ),
);

/** The backlight's level, 0 to 1, or `undefined` before it is read. */
export const useBacklightLevel = (): number | undefined =>
  useDeskWatch((domicile) => deskBacklight(domicile).level);

/** Whether the machine has a backlight, or `undefined` before it was looked for. */
export const useHasBacklight = (): Result<boolean, SystemError> | undefined =>
  useDeskWatch(deskBacklightHardware);

/**
 * Automatic brightness for the desk while mounted and `enabled`. See
 * {@link runAutoBrightness}. Mount it once, on the desktop's page.
 */
export const useAutoBrightness = (
  domicile: Domicile,
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
