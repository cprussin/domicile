// Path handling for the file picker: navigation, typed paths and the path
// bar.
//
// All paths are absolute. `~` is only typed or displayed, never sent; the
// home comes from `DomicileFileChooserEvent.home`.

import { pathIn } from "./path-in";

/** A path bar segment and the directory it links to. */
export type Crumb = { label: string; path: string };

/** The directory above `directory`, or `undefined` at the root. */
export const parentOf = (directory: string): string | undefined => {
  if (directory === "/") {
    return undefined;
  } else {
    const cut = directory.lastIndexOf("/");
    return cut === 0 ? "/" : directory.slice(0, cut);
  }
};

/**
 * Splits typed text into a directory and a filter, as a shell reads a path.
 *
 * Text up to the last `/` is resolved from root (leading `/`), home (`~/`) or
 * `directory`, with `..` going up. The rest is the filter.
 */
export const walked = ({
  directory,
  home,
  typed,
}: {
  directory: string;
  home: string;
  typed: string;
}): { directory: string; filter: string } => {
  const cut = typed.lastIndexOf("/") + 1;
  const path = typed.slice(0, cut);
  return {
    directory: joined(resolved(startOf(path, directory, home), path)),
    filter: typed.slice(cut),
  };
};

/** `path` for display, with the home shown as `~`. */
export const shownPath = (path: string, home: string): string => {
  if (path === home) {
    return "~";
  } else {
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  }
};

/**
 * The path bar segments for `directory`, starting from `~` when under the
 * home and from `/` otherwise.
 */
export const crumbsOf = (directory: string, home: string): readonly Crumb[] => {
  const underHome = directory === home || directory.startsWith(`${home}/`);
  const base = underHome ? home : "/";
  const rest = segments(directory.slice(base.length));
  return [
    { label: underHome ? "~" : "/", path: base },
    ...rest.map((label, at) => ({
      label,
      path: pathIn(base, rest.slice(0, at + 1).join("/")),
    })),
  ];
};

/** The base segments a typed path resolves from. */
const startOf = (
  path: string,
  directory: string,
  home: string,
): readonly string[] => {
  if (path.startsWith("/")) {
    return [];
  } else {
    return segments(path.startsWith("~/") ? home : directory);
  }
};

/** Resolves `path` against `start`; `..` never goes above root. */
const resolved = (start: readonly string[], path: string): readonly string[] =>
  segments(path.startsWith("~/") ? path.slice(2) : path).reduce<
    readonly string[]
  >((kept, segment) => {
    switch (segment) {
      case ".": {
        return kept;
      }
      case "..": {
        return kept.slice(0, -1);
      }
      default: {
        return [...kept, segment];
      }
    }
  }, start);

const segments = (path: string): readonly string[] =>
  path.split("/").filter((segment) => segment !== "");

const joined = (parts: readonly string[]): string => `/${parts.join("/")}`;
