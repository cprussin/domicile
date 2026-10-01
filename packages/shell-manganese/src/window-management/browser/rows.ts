// What a file picker lists for a directory the engine read.

import { ChooserMode } from "./file-request";
import { pathIn } from "./path-in";
import { parentOf } from "./walk-path";

/** What a row is, which is what choosing it does. */
export enum RowKind {
  /** `..`: the way back up. */
  Parent,
  Directory,
  File,
}

export type Row = {
  kind: RowKind;
  name: string;
  /** Absolute: what walking into or choosing the row names. */
  path: string;
};

type Listed = {
  /** Extensions the page will take, lower case and dotless; empty is any. */
  accept: readonly string[];
  directory: string;
  /** What the engine listed in `directory`: a directory's ends in `/`. */
  entries: readonly string[];
  /** What is typed in the box, which narrows the listing. */
  filter: string;
  mode: ChooserMode;
};

/**
 * The rows for `directory`: `..` first everywhere but the root, then its
 * directories, then the files the question can take — what the page accepts,
 * to open; none, to choose a folder; and every one, to save, which is a list
 * of names already taken.
 *
 * The filter narrows each to the names holding it in any case, those starting
 * with it first, so Enter after typing a name takes that name. A name starting
 * with a dot is left out until a dot is typed, a shell's convention.
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
 * Whether a file of `lowered` name is one the page will take. At the end of
 * the name and after a dot, so `tar.gz` is `backup.tar.gz` and not
 * `notargz`.
 */
const takes = (accept: readonly string[], lowered: string): boolean =>
  accept.length === 0 ||
  accept.some((extension) => lowered.endsWith(`.${extension}`));
