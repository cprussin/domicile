// Whether the machine has Bluetooth hardware, from /sys, whether or not BlueZ
// runs or rfkill has turned the radio off.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { SysfsDesktop } from "@domicile-desktop/sdk/sysfs";
import { anyOf, sysfsEntries, sysfsLine } from "@domicile-desktop/sdk/sysfs";
import type { SystemError } from "@domicile-desktop/sdk/system";

/**
 * Whether there is a Bluetooth controller, or an rfkill switch for one. A
 * radio rfkill blocks can take its controller away with it, and its switch
 * stays.
 */
export const hasBluetoothHardware = async (
  domicile: SysfsDesktop,
): Promise<Result<boolean, SystemError>> =>
  (await sysfsEntries(domicile, "/sys/class/bluetooth")).match({
    Err: (error) => Promise.resolve(Err(error)),
    Ok: async (controllers) =>
      controllers.length > 0
        ? Ok(true)
        : (await sysfsEntries(domicile, "/sys/class/rfkill")).match({
            Err: (error) => Promise.resolve(Err(error)),
            Ok: (switches) =>
              anyOf(switches, async (name) =>
                (
                  await sysfsLine(domicile, `/sys/class/rfkill/${name}/type`)
                ).map((type) =>
                  type.match({
                    None: () => false,
                    Some: (is) => is === "bluetooth",
                  }),
                ),
              ),
          }),
  });
