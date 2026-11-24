// The terminal the desk's config names, which `Terminal=true` applications
// such as htop and vim run in. See `domicile_host::desk_terminal`.

import type { Option, Result } from "@cprussin/option-result";
import { None, Some } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { AppsDesktop } from "./apps-desktop";

import { desktopEnvironment, setVariable } from "./environment";

/** The variable the compositor puts the config's `terminal` in, as JSON. */
export const TERMINAL_VARIABLE = "DOMICILE_TERMINAL";

/**
 * The desk's terminal: an argv that opens one on its own, and runs an
 * application's argv put after it. Nothing when the config names none, since
 * Domicile has no default terminal.
 */
export const deskTerminal = async (
  domicile: AppsDesktop,
): Promise<Result<Option<readonly string[]>, SystemError>> =>
  (await desktopEnvironment(domicile)).map((variables) => {
    const terminal = terminalOf(variables);
    return terminal === undefined ? None() : Some(terminal);
  });

/** The terminal `variables` name, or `undefined` for none or a bad value. */
export const terminalOf = (
  variables: ReadonlyMap<string, string>,
): readonly string[] | undefined => {
  const value = setVariable(variables, TERMINAL_VARIABLE);
  if (value === undefined) {
    return undefined;
  }
  try {
    const argv: unknown = JSON.parse(value);
    return Array.isArray(argv) &&
      argv.length > 0 &&
      argv.every((word) => typeof word === "string")
      ? (argv as string[])
      : undefined;
  } catch {
    return undefined;
  }
};
