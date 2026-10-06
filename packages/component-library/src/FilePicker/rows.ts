// The file picker's rows for a listed directory.

import { ChooserMode } from "./file-request";
import { pathIn } from "./path-in";
import { parentOf } from "./walk-path";

/** A row's kind, which decides what choosing it does. */
export enum RowKind {
  /** `..`, the parent directory. */
  Parent,
  Directory,
  File,
}

export type Row = {
  kind: RowKind;
  name: string;
  /** The absolute path. */
  path: string;
};

type Listed = {
  /** Accepted extensions, lowercase and without the dot; empty accepts any. */
  accept: readonly string[];
  directory: string;
  /** The entries in `directory`; subdirectory names end in `/`. */
  entries: readonly string[];
  /** The filter text. */
  filter: string;
  mode: ChooserMode;
};

/**
 * The rows for `directory`: `..` (except at root), then directories, then
 * files. Open modes show accepted files, folder mode shows none, and save
 * shows all so taken names are visible.
 *
 * The filter matches case-insensitively, prefix matches first, so Enter after
 * typing a name picks it. Dotfiles are hidden until the filter starts with a
 * dot, as in a shell.
 */
export const rowsIn = ({
  accept,
  directory,
  entries,
  filter,
  mode,
}: Listed): readonly Row[] => {
  const lowered = filter.toLowerCase();
  const rows = entries
    .map((entry) => rowOf(directory, entry))
    .filter(
      ({ kind, name }) =>
        name.toLowerCase().includes(lowered) &&
        (!name.startsWith(".") || filter.startsWith(".")) &&
        (kind === RowKind.Directory || offersFile(mode, accept, name)),
    )
    .toSorted(
      (a, b) =>
        a.kind - b.kind ||
        Number(!startsWith(a, lowered)) - Number(!startsWith(b, lowered)) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  const parent = parentOf(directory);
  return parent !== undefined && "..".startsWith(filter)
    ? [{ kind: RowKind.Parent, name: "..", path: parent }, ...rows]
    : rows;
};

const rowOf = (directory: string, entry: string): Row => {
  const isDirectory = entry.endsWith("/");
  const name = isDirectory ? entry.slice(0, -1) : entry;
  return {
    kind: isDirectory ? RowKind.Directory : RowKind.File,
    name,
    path: pathIn(directory, name),
  };
};

const offersFile = (
  mode: ChooserMode,
  accept: readonly string[],
  name: string,
): boolean => {
  switch (mode) {
    case ChooserMode.Open:
    case ChooserMode.OpenMultiple: {
      return takes(accept, name.toLowerCase());
    }
    case ChooserMode.OpenFolder: {
      return false;
    }
    case ChooserMode.Save: {
      return true;
    }
  }
};

const startsWith = ({ name }: Row, lowered: string): boolean =>
  name.toLowerCase().startsWith(lowered);

/**
 * Whether the lowercase file name has an accepted extension. Matches after a
 * dot, so `tar.gz` matches `backup.tar.gz` but not `notargz`.
 */
const takes = (accept: readonly string[], lowered: string): boolean =>
  accept.length === 0 ||
  accept.some((extension) => lowered.endsWith(`.${extension}`));
