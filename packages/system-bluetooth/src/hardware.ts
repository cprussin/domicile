// Whether the machine has Bluetooth hardware, from /sys, whether or not BlueZ
// runs or rfkill has turned the radio off.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

/** The calls the check makes. Each works while the desktop is locked. */
export type SysfsSystem = Pick<System, "readDir" | "readTextFile">;

/**
 * Whether there is a Bluetooth controller, or an rfkill switch for one. A
 * radio rfkill blocks can take its controller away with it, and its switch
 * stays.
 */
export const hasBluetoothHardware = async (
  system: SysfsSystem,
): Promise<Result<boolean, SystemError>> =>
  (await entriesOf(system, "/sys/class/bluetooth")).match({
    Err: (error) => Promise.resolve(Err(error)),
    Ok: async (controllers) =>
      controllers.length > 0
        ? Ok(true)
        : (await entriesOf(system, "/sys/class/rfkill")).match({
            Err: (error) => Promise.resolve(Err(error)),
            Ok: (switches) =>
              anyOf(switches, async (name) =>
                (await lineOf(system, `/sys/class/rfkill/${name}/type`)).map(
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
  system: SysfsSystem,
  dir: string,
): Promise<Result<string[], SystemError>> =>
  (await system.readDir(dir)).match({
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
  system: SysfsSystem,
  path: string,
): Promise<Result<Option<string>, SystemError>> =>
  (await system.readTextFile(path)).match({
    Err: (error) =>
      error.kind === SystemErrorKind.NotFound ? Ok(None()) : Err(error),
    Ok: (text) => Ok(Some(text.trim())),
  });
