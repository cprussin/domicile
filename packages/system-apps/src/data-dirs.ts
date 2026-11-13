// The XDG data directories, where desktop entries and icons are installed. See
// https://specifications.freedesktop.org/basedir-spec/latest/.

import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { AppsDesktop } from "./apps-desktop";

import { desktopEnvironment, setVariable } from "./environment";
import { terminalOf } from "./terminal";

/** The spec's default for an unset or empty `XDG_DATA_DIRS`. */
const DEFAULT_DATA_DIRS = "/usr/local/share:/usr/share";

/**
 * The desktop's data directories, highest priority first: `XDG_DATA_HOME`,
 * then each of `XDG_DATA_DIRS`.
 *
 * Read from the environment processes start in, which a page cannot see. An
 * unset data home is `.local/share`, relative to the home as every system
 * call's path is.
 */
export const dataDirs = async (
  domicile: AppsDesktop,
): Promise<Result<string[], SystemError>> =>
  (await desktopEnvironment(domicile)).map(dataDirsOf);

/**
 * {@link dataDirs} and the desk's terminal (see `./terminal`), from one read
 * of the environment: what listing the applications takes.
 */
export const appPlaces = async (
  domicile: AppsDesktop,
): Promise<
  Result<
    { dirs: string[]; terminal: readonly string[] | undefined },
    SystemError
  >
> =>
  (await desktopEnvironment(domicile)).map((variables) => ({
    dirs: dataDirsOf(variables),
    terminal: terminalOf(variables),
  }));

/** The data directories `variables` name. */
const dataDirsOf = (variables: ReadonlyMap<string, string>): string[] => [
  setVariable(variables, "XDG_DATA_HOME") ?? ".local/share",
  ...(setVariable(variables, "XDG_DATA_DIRS") ?? DEFAULT_DATA_DIRS).split(":"),
];
