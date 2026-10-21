// Whether the machine has sound hardware, from /sys, whether or not a sound
// server runs.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

/** The calls the check makes. Each works while the desktop is locked. */
export type SysfsSystem = Pick<System, "readDir" | "readTextFile">;

/** ALSA's cards, `card0` and on; the class's other entries are their devices and the timer. */
const CARD = /^card[0-9]+$/;

/** Whether ALSA has a sound card. */
export const hasSoundCard = async (
  system: SysfsSystem,
): Promise<Result<boolean, SystemError>> =>
  (await entriesOf(system, "/sys/class/sound")).map((names) =>
    names.some((name) => CARD.test(name)),
  );

/** The names in `dir`; none when it does not exist, as when no driver made it. */
const entriesOf = async (
  system: SysfsSystem,
  dir: string,
): Promise<Result<string[], SystemError>> =>
  (await system.readDir(dir)).match({
    Err: (error) =>
      error.kind === SystemErrorKind.NotFound ? Ok([]) : Err(error),
    Ok: (entries) => Ok(entries.map(({ name }) => name)),
  });
