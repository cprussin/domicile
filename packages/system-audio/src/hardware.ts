// Whether the machine has sound hardware, from /sys, whether or not a sound
// server runs.

import type { Result } from "@cprussin/option-result";

import type { SysfsDesktop } from "@domicile-desktop/sdk/sysfs";
import { sysfsEntries } from "@domicile-desktop/sdk/sysfs";
import type { SystemError } from "@domicile-desktop/sdk/system";

/** ALSA's cards, `card0` and on; the class's other entries are their devices and the timer. */
const CARD = /^card[0-9]+$/;

/** Whether ALSA has a sound card. */
export const hasSoundCard = async (
  domicile: SysfsDesktop,
): Promise<Result<boolean, SystemError>> =>
  (await sysfsEntries(domicile, "/sys/class/sound")).map((names) =>
    names.some((name) => CARD.test(name)),
  );
