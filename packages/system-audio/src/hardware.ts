// Whether the machine has sound hardware, from /sys, whether or not a sound
// server runs.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { Files } from "@domicile-desktop/sdk/desktop/files";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

/** The calls the check makes. Each works while the desktop is locked. */
export type SysfsDesktop = {
  readonly files: Pick<Files, "readDir" | "readText">;
};

/** ALSA's cards, `card0` and on; the class's other entries are their devices and the timer. */
const CARD = /^card[0-9]+$/;

/** Whether ALSA has a sound card. */
export const hasSoundCard = async (
  domicile: SysfsDesktop,
): Promise<Result<boolean, SystemError>> =>
  (await entriesOf(domicile, "/sys/class/sound")).map((names) =>
    names.some((name) => CARD.test(name)),
  );

/** The names in `dir`; none when it does not exist, as when no driver made it. */
const entriesOf = async (
  domicile: SysfsDesktop,
  dir: string,
): Promise<Result<string[], SystemError>> =>
  (await domicile.files.readDir(dir)).match({
    Err: (error) =>
      error.kind === SystemErrorKind.NotFound ? Ok([]) : Err(error),
    Ok: (entries) => Ok(entries.map(({ name }) => name)),
  });
