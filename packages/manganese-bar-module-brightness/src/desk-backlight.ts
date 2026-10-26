import type { Result } from "@cprussin/option-result";
import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { watchPresence } from "@domicile-desktop/react/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { readBacklight } from "@domicile-desktop/system-backlight/read-backlight";
import { hostBacklight } from "./host-backlight";
import type { SharedBacklight } from "./shared-backlight";
import { sharedBacklight } from "./shared-backlight";

/** The backlight, watched once for every bar and the lock screen. */
export const deskBacklight = perDesktop(
  (domicile): SharedBacklight => sharedBacklight(hostBacklight(domicile)),
);

/** Whether the machine has a backlight, looked for once for every bar and the lock screen. */
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
