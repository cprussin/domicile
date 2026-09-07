// Which file on disk a request path means, if any.
//
// Separate from the server and tested on its own because this is the part that
// is a security question rather than a plumbing one. The bridge serves a
// directory over HTTP to a browser that is showing somebody's desktop; a path
// that escapes that directory serves the machine instead.
//
// `..` is not the only way out and stripping it is not the fix — `%2e%2e%2f`
// decodes to one, a leading `/` is absolute, and a symlink inside the root
// points wherever it likes. So nothing is stripped or matched. The path is
// resolved and then *checked to still be inside the root*, which is the one
// formulation that does not depend on having thought of every trick.

import path from "node:path";

/**
 * The absolute file `requestPath` names inside `root`, or `undefined` when it
 * names something outside it.
 *
 * `/` and any path ending in `/` mean that directory's `index.html`, which is
 * what a browser asking for a shell's page is asking for.
 *
 * Symlinks are deliberately NOT resolved here: this answers what path was
 * asked for, and whether the file it lands on is one the server should read is
 * the server's to decide when it opens it. Resolving them would also make this
 * touch the disk, which is what keeps it testable without one.
 */
export const fileForRequest = (
  root: string,
  requestPath: string,
): string | undefined => {
  const decoded = decode(requestPath);
  if (decoded === undefined) {
    return undefined;
  }

  // A URL's pathname always begins with `/`, but this takes a string and a
  // caller that hands it a relative one would otherwise get `".."` concatenated
  // onto `"."` and a resolved path that means nothing. Made absolute first, so
  // that `normalize` clamps it.
  const rooted = decoded.startsWith("/") ? decoded : `/${decoded}`;
  const withIndex = rooted.endsWith("/") ? `${rooted}index.html` : rooted;
  const absoluteRoot = path.resolve(root);
  // `.` + an absolute path makes it relative, so `path.resolve` joins it to
  // the root instead of treating it as absolute and returning it whole.
  const resolved = path.resolve(
    absoluteRoot,
    `.${path.posix.normalize(withIndex)}`,
  );

  // Belt and braces. `path.posix.normalize` already clamps an absolute path's
  // `..` at the top, so nothing reaching here should be outside the root — but
  // this is the property that actually matters and it costs one comparison to
  // assert rather than infer. The trailing separator is part of it: without it
  // a sibling whose name starts with the root's — `/build/shell-x` against a
  // root of `/build/shell` — passes a plain prefix test.
  if (
    resolved !== absoluteRoot &&
    !resolved.startsWith(absoluteRoot + path.sep)
  ) {
    return undefined;
  }
  return resolved;
};

/**
 * `requestPath` with its percent-escapes resolved, or `undefined` if it is not
 * valid encoding.
 *
 * Decoded once and only once. A path is decoded by whoever receives it, so
 * decoding twice here would accept `%252e%252e%252f` — an escape that the
 * check above would then be reading after the very step that hid it.
 */
const decode = (requestPath: string): string | undefined => {
  try {
    const decoded = decodeURIComponent(requestPath);
    // A NUL truncates the name for anything that later hands it to C, so the
    // path that was checked and the path that is opened would differ.
    return decoded.includes("\0") ? undefined : decoded;
  } catch {
    return undefined;
  }
};
