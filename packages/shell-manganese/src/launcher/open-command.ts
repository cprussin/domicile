// What the launcher asks the compositor to run for a file.
//
// # Why there is a shell in here
//
// `$HOME` exists in the process the compositor spawns and nowhere this page
// can reach: a shell served over `domicile://` has an origin, not an
// environment, and the host answers `search_files` in paths relative to a home
// directory it never names. So it is read where it is, by the one thing in
// this path that can read it.
//
// Which application opens the file is `xdg-open`'s to decide, from the user's
// MIME associations, rather than this page's. `exec` keeps the `sh` from
// sitting above it as a parent; what `xdg-open` itself starts is its business.
//
// # Why the path is an argument
//
// A path is user text and this is a shell script. A file called `; rm -rf ~`
// interpolated into the script would be a command; as `$1` it is a filename
// with a semicolon in it. The quoting around `$1` is what keeps it one word.

/**
 * The script `$HOME` is read by.
 *
 * The `case` is the only branch: a path the host offered is relative to the
 * home directory and an absolute one is already where it says. Deciding that
 * here rather than in the page is deliberate — the page does not know what
 * `$HOME` is, which is exactly why the protocol answers in relative paths.
 */
const SCRIPT =
  'case $1 in /*) exec xdg-open "$1" ;; *) exec xdg-open "$HOME/$1" ;; esac';

/** `$0` for the script, which is what a diagnostic from `sh` is prefixed with. */
const NAME = "domicile-launcher";

/** The argv that opens `path` with the user's default application. */
export const openCommand = (path: string): readonly string[] => [
  "sh",
  "-c",
  SCRIPT,
  NAME,
  path,
];
