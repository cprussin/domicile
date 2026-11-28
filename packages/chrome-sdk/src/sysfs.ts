// Reading `/sys` through the desktop's files, as a shell checks for hardware
// whether or not the daemon that drives it runs. A missing file or directory
// is an answer here, not an error: it is how sysfs says a driver made
// nothing. Each call works while the desktop is locked.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";

import type { Files } from "./desktop/files";
import type { SystemError } from "./system";
import { SystemErrorKind } from "./system";

/** The calls these make. */
export type SysfsDesktop = {
  readonly files: Pick<Files, "readDir" | "readText">;
};

/** The names in `dir`; none when it does not exist. */
export const sysfsEntries = async (
  domicile: SysfsDesktop,
  dir: string,
): Promise<Result<string[], SystemError>> =>
  (await domicile.files.readDir(dir)).match({
    Err: (error) =>
      error.kind === SystemErrorKind.NotFound ? Ok([]) : Err(error),
    Ok: (entries) => Ok(entries.map(({ name }) => name)),
  });

/** A one-line file, without its newline; `None` when it does not exist. */
export const sysfsLine = async (
  domicile: SysfsDesktop,
  path: string,
): Promise<Result<Option<string>, SystemError>> =>
  (await domicile.files.readText(path)).match({
    Err: (error) =>
      error.kind === SystemErrorKind.NotFound ? Ok(None()) : Err(error),
    Ok: (text) => Ok(Some(text.trim())),
  });

/**
 * Whether `test` holds for any of `names`, tried one at a time and stopping
 * at the first that does, or at the first error.
 */
export const anyOf = async (
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
