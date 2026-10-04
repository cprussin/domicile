// Splits a found path into name and directory for display.
//
// The name identifies the file; the directory only disambiguates. The row
// draws them separately so truncation never hides the name.
//
// The host marks directories with a trailing `/` (see
// `domicile_host::file_search`), since the page has no filesystem access.

/** A path split for display. */
export type FileRow = {
  /** The parent directory, or `undefined` at the top of home. */
  directory: string | undefined;
  isDirectory: boolean;
  /** The last segment. */
  name: string;
  /** The path without the trailing slash, for opening. */
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
