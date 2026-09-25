// How the launcher reads one of the paths the host found.
//
// A path is read from its end. The name is what identifies it — it is what
// the user typed part of — and the directories above it are only there to
// tell two files of the same name apart, so the row draws the two separately
// rather than handing a line of text to `text-overflow` and hoping the
// interesting half survives.
//
// WHAT IS A DIRECTORY IS THE HOST'S TO SAY, and it says it with a trailing
// `/` — see `domicile_host::file_search`. A page has no filesystem, and the
// host is the one holding every other path it could be told apart by.

/** A path as the list draws it. */
export type FileRow = {
  /** What is above the name, or `undefined` at the top of home. */
  directory: string | undefined;
  isDirectory: boolean;
  /** The last segment: what identifies the path. */
  name: string;
  /** The path itself, without the host's slash: what a row opens. */
  path: string;
};

export const fileRow = (found: string): FileRow => {
  const isDirectory = found.endsWith("/");
  const path = isDirectory ? found.slice(0, -1) : found;
  const cut = path.lastIndexOf("/");
  return {
    directory: cut === -1 ? undefined : path.slice(0, cut),
    isDirectory,
    name: path.slice(cut + 1),
    path,
  };
};
