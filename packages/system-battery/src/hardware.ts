// Whether the machine has a battery, from /sys, whether or not UPower runs.

import type { Result } from "@cprussin/option-result";
import { Err } from "@cprussin/option-result";
import type { SysfsDesktop } from "@domicile-desktop/sdk/sysfs";
import { anyOf, sysfsEntries, sysfsLine } from "@domicile-desktop/sdk/sysfs";
import type { SystemError } from "@domicile-desktop/sdk/system";

const SUPPLIES = "/sys/class/power_supply";

/**
 * Whether a power supply is the machine's battery. A peripheral's, such as a
 * mouse's, has the scope `Device`.
 */
export const hasBattery = async (
  domicile: SysfsDesktop,
): Promise<Result<boolean, SystemError>> =>
  (await sysfsEntries(domicile, SUPPLIES)).match({
    Err: (error) => Promise.resolve(Err(error)),
    Ok: (supplies) =>
      anyOf(supplies, async (name) => {
        const type = await sysfsLine(domicile, `${SUPPLIES}/${name}/type`);
        const scope = await sysfsLine(domicile, `${SUPPLIES}/${name}/scope`);
        return type.andThen((kind) =>
          scope.map(
            (of) =>
              kind.match({
                None: () => false,
                Some: (is) => is === "Battery",
              }) &&
              of.match({ None: () => true, Some: (is) => is !== "Device" }),
          ),
        );
      }),
  });
