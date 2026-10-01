// Where a file picker is, and where what is typed in its box takes it.
//
// EVERY PATH HERE IS ABSOLUTE. The picker starts in the home the engine tells
// it — see `DomicileFileChooserEvent.home` — and walks from there, so `~` is
// only ever something typed or drawn, never something sent.

import { pathIn } from "./path-in";

/** A step of the path bar: what it says, and where clicking it goes. */
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
 * Where the box takes the picker, the way a shell's prompt reads a path:
 * everything up to the last `/` is walked — from the root after a leading `/`,
 * from the home after `~/`, and from `directory` otherwise, with `..` going up
 * — and what follows it narrows the listing. A box with no `/` walks nowhere.
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

/** `path` as it is drawn: under the home, from `~`. */
export const shownPath = (path: string, home: string): string => {
  if (path === home) {
    return "~";
  } else {
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  }
};

/**
 * The path bar's steps to `directory`: from the home for anywhere under it,
 * which is where nearly everything picked is, and from the root otherwise.
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

/** The segments a typed path starts from, before its own are walked. */
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

/** `start` walked by the segments of `path`, `..` going up and never past the root. */
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
