// The XDG data directories, where desktop entries and icons are installed. See
// https://specifications.freedesktop.org/basedir-spec/latest/.

import type { Result } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";

import { desktopEnvironment, setVariable } from "./environment";

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
  system: System,
): Promise<Result<string[], SystemError>> =>
  (await desktopEnvironment(system)).map((variables) => [
    setVariable(variables, "XDG_DATA_HOME") ?? ".local/share",
    ...(setVariable(variables, "XDG_DATA_DIRS") ?? DEFAULT_DATA_DIRS).split(
      ":",
    ),
  ]);
