// What the launcher asks the compositor to run for a file.
//
// # Why there is a shell in here
//
// `$EDITOR` and `$HOME` exist in the process the compositor spawns and nowhere
// this page can reach: a shell served over `domicile://` has an origin, not an
// environment, and the host answers `search_files` in paths relative to a home
// directory it never names. So the two are read where they are, by the one
// thing in this path that can read them.
//
// `exec` is what keeps it from being a process tree: the `sh` is replaced by
// the editor rather than sitting above it as a parent, so what the compositor
// started and what maps a window are the same process. Nothing waits on
// anything, and a `kill` from the desktop reaches the editor.
//
// # Why the path is an argument
//
// A path is user text and this is a shell script. A file called `; rm -rf ~`
// interpolated into the script would be a command; as `$1` it is a filename
// with a semicolon in it. The quoting around `$1` is what keeps it one word.

/**
 * The script the two environment variables are read by.
 *
 * The `case` is the only branch: a path the host offered is relative to the
 * home directory and an absolute one is already where it says. Deciding that
 * here rather than in the page is deliberate — the page does not know what
 * `$HOME` is, which is exactly why the protocol answers in relative paths.
 */
const SCRIPT =
  'case $1 in /*) exec "$EDITOR" "$1" ;; *) exec "$EDITOR" "$HOME/$1" ;; esac';

/** `$0` for the script, which is what a diagnostic from `sh` is prefixed with. */
const NAME = "domicile-launcher";

/** The argv that opens `path` in the user's editor. */
export const editorCommand = (path: string): readonly string[] => [
  "sh",
  "-c",
  SCRIPT,
  NAME,
  path,
];
