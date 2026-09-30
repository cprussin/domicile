// Which of the paths the host found a picker offers, by what the page asked
// for.
//
// The host's search knows nothing about the question: it answers a query over
// the whole home, files and directories alike, and a directory is the one that
// ends in `/` — see `domicile_host::file_search`. So the narrowing to what the
// page can take is done here, on the rows it sent.

import type { FileRow } from "../../launcher/file-row";
import { fileRow } from "../../launcher/file-row";
import type { Browsing } from "./browsing";
import { ChooserMode } from "./file-request";
import { pathIn } from "./path-in";

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

type Listed = {
  /** Extensions the page will take, lower case and dotless; empty is any. */
  accept: readonly string[];
  /** The box, read as the directory listed and the name looked for in it. */
  browsed: Browsing;
  /** What the engine listed in that directory: a directory's ends in `/`. */
  entries: readonly string[];
  mode: ChooserMode;
};

/**
 * The rows a picker offers out of a directory it listed: its directories
 * first, which are where to walk — and, to open, the files after them the page
 * will take. To choose a folder or save in one, the directory itself is first
 * while nothing narrows the listing.
 *
 * What is typed after the last `/` narrows it to the names holding it, in any
 * case; a name that starts with a dot is left out until a dot is typed, which
 * is a shell's convention.
 */
export const pickableIn = ({
  accept,
  browsed: { directory, filter, typed },
  entries,
  mode,
}: Listed): readonly FileRow[] => {
  const lowered = filter.toLowerCase();
  const rows = entries
    .map((entry) => {
      const isDirectory = entry.endsWith("/");
      const name = isDirectory ? entry.slice(0, -1) : entry;
      return {
        directory: undefined,
        isDirectory,
        name,
        path: pathIn(directory, name),
      };
    })
    .filter(
      ({ name }) =>
        name.toLowerCase().includes(lowered) &&
        (!name.startsWith(".") || filter.startsWith(".")),
    )
    .toSorted(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  const directories = rows.filter((row) => row.isDirectory);
  switch (mode) {
    case ChooserMode.Open:
    case ChooserMode.OpenMultiple: {
      return rows.filter(
        (row) => row.isDirectory || takes(accept, row.name.toLowerCase()),
      );
    }
    case ChooserMode.OpenFolder:
    case ChooserMode.Save: {
      return filter === ""
        ? [itself(directory, typed), ...directories]
        : directories;
    }
  }
};

/**
 * The directory being listed, as a row: home as {@link HOME}, and anywhere
 * else as the path typed to reach it.
 */
const itself = (directory: string, typed: string): FileRow => {
  if (directory === "") {
    return HOME;
  } else {
    return {
      directory: undefined,
      isDirectory: true,
      name: typed === "/" ? typed : typed.slice(0, -1),
      path: directory,
    };
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
