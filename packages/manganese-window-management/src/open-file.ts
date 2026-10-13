// The argv that opens a file the launcher found: the type's default
// application, as the AppChooser dialog would pick it, else `xdg-open`.

import type { System } from "@domicile-desktop/sdk/system";
import { openers } from "@domicile-desktop/system-apps/openers";

import { openCommand } from "./open-command";

/**
 * The argv that opens `path`, relative to home or absolute.
 *
 * Runs the first of `openers`' applications, which reads
 * `domicile-mimeapps.list` first, so a file opens with the application the
 * portals offer. A type it finds nothing for goes to `xdg-open`, which also
 * reads aliases, subclasses and contents.
 */
export const openFileCommand = async (
  system: System,
  path: string,
): Promise<readonly string[]> =>
  (await openers(system, path)).match({
    Err: (error) => {
      throw new Error(`could not find what opens ${path}: ${error.message}`);
    },
    Ok: ({ apps: [first], command }) =>
      first === undefined ? openCommand(path) : command(first),
  });
