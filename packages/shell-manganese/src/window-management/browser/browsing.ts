// A picker's box read as a path, for walking the filesystem rather than
// searching the home's index.
//
// A BOX THAT STARTS WITH `/` OR `~/` IS A PATH, and anything else is a search.
// The index only holds the home, so a file anywhere else — a mounted disk,
// `/tmp` — is reached by typing where it is, the way a shell's prompt
// completes one: everything up to the last `/` is the directory listed, and
// what follows it narrows the listing.

/** The box, read as a directory and a name being looked for in it. */
export type Browsing = {
  /**
   * The directory to list, as the engine takes one: absolute, or relative to
   * the home, where `""` is the home itself.
   */
  directory: string;
  /** What follows the last `/`: the name being looked for. */
  filter: string;
  /**
   * The box up to and including its last `/` — what walking into a row
   * appends that row's name to.
   */
  typed: string;
};

/** The box as a path, or `undefined` when it is a search. */
export const browsing = (query: string): Browsing | undefined => {
  if (query === "~") {
    return { directory: "", filter: "", typed: "~/" };
  } else if (query.startsWith("~/") || query.startsWith("/")) {
    const cut = query.lastIndexOf("/") + 1;
    const typed = query.slice(0, cut);
    const home = typed.startsWith("~/");
    const segments = resolved(typed.slice(home ? 2 : 1).split("/"));
    return {
      directory: home ? segments.join("/") : `/${segments.join("/")}`,
      filter: query.slice(cut),
      typed,
    };
  } else {
    return undefined;
  }
};

/**
 * The directory above `typed` — a {@link Browsing.typed} — spelled as it was
 * typed, or `undefined` at the top: `~/` and `/` have nothing above them to
 * walk to.
 */
export const parentOf = (typed: string): string | undefined =>
  typed === "~/" || typed === "/"
    ? undefined
    : typed.slice(0, typed.lastIndexOf("/", typed.length - 2) + 1);

/**
 * What the box says to list the directory at `path` — absolute, or relative to
 * home — which is how walking into a row spells it.
 */
export const typedOf = (path: string): string => {
  switch (path) {
    case "": {
      return "~/";
    }
    case "/": {
      return "/";
    }
    default: {
      return path.startsWith("/") ? `${path}/` : `~/${path}/`;
    }
  }
};

/**
 * `segments` with `.` and empty ones dropped and each `..` taking the one
 * before it — the engine refuses a path that climbs, so one typed is resolved
 * here. A `..` with nothing before it goes nowhere: the top of what was typed
 * is as far as it walks.
 */
const resolved = (segments: readonly string[]): readonly string[] =>
  segments.reduce<readonly string[]>((kept, segment) => {
    switch (segment) {
      case "":
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
  }, []);
