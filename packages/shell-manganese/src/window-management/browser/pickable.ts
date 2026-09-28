// Which of the paths the host found a picker offers, by what the page asked
// for.
//
// The host's search knows nothing about the question: it answers a query over
// the whole home, files and directories alike, and a directory is the one that
// ends in `/` — see `domicile_host::file_search`. So the narrowing to what the
// page can take is done here, on the rows it sent.

import type { FileRow } from "../../launcher/file-row";
import { fileRow } from "../../launcher/file-row";
import { ChooserMode } from "./file-request";

/**
 * Home itself, as a row: the one directory no search can find, because every
 * path the host answers with is inside it.
 */
export const HOME: FileRow = {
  directory: undefined,
  isDirectory: true,
  name: "Home",
  path: "",
};

type Asked = {
  /** Extensions the page will take, lower case and dotless; empty is any. */
  accept: readonly string[];
  /** What the host found, in its own vocabulary. */
  found: readonly string[];
  mode: ChooserMode;
  /** What the search box says, which decides whether home is offered. */
  query: string;
};

/**
 * The rows a picker offers: files the page will take to open, directories to
 * open as a folder, and directories to save in — home first while nothing has
 * been typed. A query is the user looking for somewhere else, and Enter on it
 * should not land in home.
 */
export const pickable = ({
  accept,
  found,
  mode,
  query,
}: Asked): readonly FileRow[] => {
  const rows = found.map((path) => fileRow(path));
  switch (mode) {
    case ChooserMode.Open:
    case ChooserMode.OpenMultiple: {
      return rows.filter(
        (row) => !row.isDirectory && takes(accept, row.name.toLowerCase()),
      );
    }
    case ChooserMode.OpenFolder: {
      return rows.filter((row) => row.isDirectory);
    }
    case ChooserMode.Save: {
      const directories = rows.filter((row) => row.isDirectory);
      return query === "" ? [HOME, ...directories] : directories;
    }
  }
};

/**
 * Whether a file of `lowered` name is one the page will take. At the end of
 * the name and after a dot, so `tar.gz` is `backup.tar.gz` and not
 * `notargz`.
 */
const takes = (accept: readonly string[], lowered: string): boolean =>
  accept.length === 0 ||
  accept.some((extension) => lowered.endsWith(`.${extension}`));
