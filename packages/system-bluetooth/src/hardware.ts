// Whether the machine has Bluetooth hardware, from /sys, whether or not BlueZ
// runs or rfkill has turned the radio off.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { Files } from "@domicile-desktop/sdk/desktop/files";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

/** The calls the check makes. Each works while the desktop is locked. */
export type SysfsDesktop = {
  readonly files: Pick<Files, "readDir" | "readText">;
};

/**
 * Whether there is a Bluetooth controller, or an rfkill switch for one. A
 * radio rfkill blocks can take its controller away with it, and its switch
 * stays.
 */
export const hasBluetoothHardware = async (
  domicile: SysfsDesktop,
): Promise<Result<boolean, SystemError>> =>
  (await entriesOf(domicile, "/sys/class/bluetooth")).match({
    Err: (error) => Promise.resolve(Err(error)),
    Ok: async (controllers) =>
      controllers.length > 0
        ? Ok(true)
        : (await entriesOf(domicile, "/sys/class/rfkill")).match({
            Err: (error) => Promise.resolve(Err(error)),
            Ok: (switches) =>
              anyOf(switches, async (name) =>
                (await lineOf(domicile, `/sys/class/rfkill/${name}/type`)).map(
                  (type) =>
                    type.match({
                      None: () => false,
                      Some: (is) => is === "bluetooth",
                    }),
                ),
              ),
          }),
  });

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

/** Whether `test` holds for any of `names`, read one at a time. */
const anyOf = async (
  names: readonly string[],
  test: (name: string) => Promise<Result<boolean, SystemError>>,
): Promise<Result<boolean, SystemError>> => {
  const [first, ...rest] = names;
  if (first === undefined) {
    return Ok(false);
  } else {
    return (await test(first)).match({
      Err: (error) => Promise.resolve(Err(error)),
      Ok: (found) => (found ? Promise.resolve(Ok(true)) : anyOf(rest, test)),
    });
  }
};

/** A one-line file under `/sys`, without its newline; `None` when missing. */
const lineOf = async (
  domicile: SysfsDesktop,
  path: string,
): Promise<Result<Option<string>, SystemError>> =>
  (await domicile.files.readText(path)).match({
    Err: (error) =>
      error.kind === SystemErrorKind.NotFound ? Ok(None()) : Err(error),
    Ok: (text) => Ok(Some(text.trim())),
  });
