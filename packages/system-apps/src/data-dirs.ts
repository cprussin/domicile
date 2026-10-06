// The XDG data directories, where desktop entries and icons are installed. See
// https://specifications.freedesktop.org/basedir-spec/latest/.

import type { Result } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";

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
  (await system.run(["env", "-0"])).map((ran) => {
    if (ran.code === 0) {
      const variables = environmentOf(ran.stdout);
      return [
        set(variables.get("XDG_DATA_HOME")) ?? ".local/share",
        ...(set(variables.get("XDG_DATA_DIRS")) ?? DEFAULT_DATA_DIRS).split(
          ":",
        ),
      ];
    } else {
      throw new Error(`env failed: ${ran.stderr}`);
    }
  });

/** `env -0`'s output: `NAME=value`, each ended by a NUL. */
const environmentOf = (output: string): ReadonlyMap<string, string> =>
  new Map(
    output
      .split("\0")
      .filter((variable) => variable.includes("="))
      .map((variable) => {
        const equals = variable.indexOf("=");
        return [variable.slice(0, equals), variable.slice(equals + 1)];
      }),
  );

/** Per the spec, an empty variable is unset. */
const set = (value: string | undefined): string | undefined =>
  value === "" ? undefined : value;
