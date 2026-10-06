// The desktop's environment, which a page cannot see.

import type { Result } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";

/** The variables the shell's processes start with, read with `env -0`. */
export const desktopEnvironment = async (
  system: System,
): Promise<Result<ReadonlyMap<string, string>, SystemError>> =>
  (await system.run(["env", "-0"])).map((ran) => {
    if (ran.code === 0) {
      return environmentOf(ran.stdout);
    } else {
      throw new Error(`env failed: ${ran.stderr}`);
    }
  });

/** Variable `name`, or `undefined` when unset or, per the XDG specs, empty. */
export const setVariable = (
  variables: ReadonlyMap<string, string>,
  name: string,
): string | undefined => {
  const value = variables.get(name);
  return value === "" ? undefined : value;
};

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
