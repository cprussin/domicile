// The command the launcher asks the compositor to run to open a file.
//
// - It runs through `sh` because the host returns paths relative to `$HOME`,
//   and the page has no environment to read `$HOME` from.
// - `xdg-open` picks the application from the user's MIME associations.
//   `exec` replaces `sh` rather than leaving it as a parent.
// - The path is passed as quoted `$1`, never interpolated, so a file name like
//   `; rm -rf ~` can't inject a command.

/**
 * The shell script that resolves the path and opens it.
 *
 * Prefixes `$HOME` to relative paths and leaves absolute ones as they are. The
 * script decides because the page doesn't know `$HOME`.
 */
const SCRIPT =
  'case $1 in /*) exec xdg-open "$1" ;; *) exec xdg-open "$HOME/$1" ;; esac';

/** `$0` for the script, which prefixes `sh` error messages. */
const NAME = "domicile-launcher";

/** The argv that opens `path` with the user's default application. */
export const openCommand = (path: string): readonly string[] => [
  "sh",
  "-c",
  SCRIPT,
  NAME,
  path,
];
