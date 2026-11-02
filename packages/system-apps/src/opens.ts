// Whether opening a file would run anything, before opening it, so a shell
// can say when nothing would.

import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { AppsDesktop } from "./apps-desktop";

/**
 * Whether an installed application opens `path`, as `domicile open` would:
 * `domicile open --which` names one. `path` is relative to home, as every
 * system call's path is, or absolute.
 */
export const opens = async (
  domicile: Pick<AppsDesktop, "processes">,
  path: string,
): Promise<Result<boolean, SystemError>> =>
  (await domicile.processes.run(["sh", "-c", WHICH, NAME, path])).map(
    ({ code, stdout }) => code === 0 && stdout.trim() !== "",
  );

/**
 * Asks `domicile open --which` of `$1`, prefixing `$HOME` to a relative path,
 * since the page cannot read `$HOME`. `$1` is quoted, never interpolated, so
 * a file name cannot inject a command. See `open-command.ts` in window
 * management.
 */
const WHICH =
  'case $1 in /*) exec domicile open --which "$1" ;; *) exec domicile open --which "$HOME/$1" ;; esac';

/** `$0` for the script, which prefixes `sh` error messages. */
const NAME = "domicile-opens";

/**
 * That no app opens the file `name`, for a shell to say so, naming the kind
 * of file by its extension.
 */
export const nothingOpens = (name: string): string => {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 || dot === base.length - 1
    ? "No app on this computer can open this file."
    : `No app on this computer can open ${base.slice(dot).toLowerCase()} files.`;
};
