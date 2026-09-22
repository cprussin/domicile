// How the launcher reads one of the paths the host offered.
//
// A path is read from its end. The name is what identifies it — it is what
// the user typed part of — and the directories above it are only there to
// tell two files of the same name apart, so the row draws the two separately
// rather than handing a line of text to `text-overflow` and hoping the
// interesting half survives.
//
// WHAT IS A DIRECTORY IS INFERRED, and from the only evidence a page has: the
// host answers with a flat list of paths and says nothing about their kind —
// see `domicile_host::files` — but a path that another offered path is inside
// of cannot be anything else.

/** A path as the list draws it. */
export type FileRow = {
  /** What is above the name, or `undefined` at the top of home. */
  directory: string | undefined;
  isDirectory: boolean;
  /** The last segment: what identifies the path. */
  name: string;
};

/** Which of the paths in `offered` hold the others. */
export const directoriesIn = (
  offered: readonly string[],
): ReadonlySet<string> => new Set(offered.flatMap(above));

export const fileRow = (
  path: string,
  directories: ReadonlySet<string>,
): FileRow => {
  const cut = path.lastIndexOf("/");
  return {
    directory: cut === -1 ? undefined : path.slice(0, cut),
    isDirectory: directories.has(path),
    name: path.slice(cut + 1),
  };
};

/**
 * Every directory `path` is under, outermost first.
 *
 * The ones nothing offered on their own line count: a home walked two levels
 * deep offers `Notes/2026/april.org` whether or not `Notes/2026` was itself
 * listed, and both names above it are directories either way.
 */
const above = (path: string): readonly string[] => {
  const segments = path.split("/");
  return segments
    .slice(0, -1)
    .map((_, at) => segments.slice(0, at + 1).join("/"));
};
