import type { Result } from "@cprussin/option-result";
import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { watchPresence } from "@domicile-desktop/manganese-host/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import { readBacklight } from "@domicile-desktop/system-backlight/read-backlight";
import { hostBacklight } from "./host-backlight";

/** The backlight's level, shared, and a way to change it. */
export type SharedBacklight = {
  /** 0 to 1. Never reported on a machine without a backlight. */
  level: SharedWatch<number>;
  /** Ask for a level from 0 to 1. `level` reports it once it is set. */
  set: (level: number) => void;
};

/** The backlight, watched once for every bar and the lock screen. */
export const deskBacklight = perHost((domicile): SharedBacklight => {
  const backlight = hostBacklight(domicile);
  return { level: sharedWatch(backlight.watch), set: backlight.set };
});

/** Whether the machine has a backlight, looked for once for every bar and the lock screen. */
export const deskBacklightHardware = perHost(
  (domicile): SharedWatch<Result<boolean, SystemError>> =>
    sharedWatch((onPresent) =>
      watchPresence(
        async () =>
          (await readBacklight(system(domicile))).map((found) =>
            found.isSome(),
          ),
        onPresent,
      ),
    ),
);
