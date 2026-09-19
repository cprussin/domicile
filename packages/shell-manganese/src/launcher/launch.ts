// What the launcher does with what was typed into it.
//
// Three answers in the order `run` decides them in the launcher this desktop
// is modelled on: a file, then a site, then a search. The order is the whole
// of the design — every query is a search if nothing better claims it first,
// so the two claims above it have to be the ones that can be made confidently.
//
// The evidence is different in each case, which is why they are ranked rather
// than pattern-matched independently. A file is either one the host listed —
// evidence, not a guess — or a path spelled in a way nothing else is. A site
// is a scheme somebody wrote down, or a host under a TLD that exists. What is
// left is words, and words are a search.

import { searchUrl } from "./search";

/** Which of the two things the launcher can do with a query. */
export enum LaunchKind {
  Edited,
  Browsed,
}

export const Launch = {
  /** Open `url` in a browser window on the desktop. */
  Browsed: (url: string) => ({ kind: LaunchKind.Browsed as const, url }),
  /**
   * Open `path` in the user's editor.
   *
   * Relative to the home directory, the way the host names what it offers, or
   * absolute for a path outside it. `editor-command.ts` is what turns the two
   * into one command.
   */
  Edited: (path: string) => ({ kind: LaunchKind.Edited as const, path }),
};

export type Launch = ReturnType<(typeof Launch)[keyof typeof Launch]>;

/**
 * What to do with `query`, given what the host said there is to open.
 *
 * `undefined` for a query with nothing in it: Enter on an empty box is a
 * keystroke nobody meant as a command, and every way of answering it — a
 * search for the empty string, an editor on the home directory — is worse than
 * not answering.
 */
export const launchFor = (
  query: string,
  offered: readonly string[],
): Launch | undefined => {
  const typed = query.trim();
  if (typed === "") {
    return undefined;
  } else if (isFile(typed, offered)) {
    return Launch.Edited(underHome(typed));
  } else if (hasScheme(typed)) {
    return Launch.Browsed(typed);
  } else if (isHost(typed)) {
    // https rather than http: a desktop should not make the insecure guess on
    // a user's behalf, and a site that only speaks http will say so.
    return Launch.Browsed(`https://${typed}`);
  } else {
    return Launch.Browsed(searchUrl(typed));
  }
};

/**
 * Whether `typed` names a file.
 *
 * Either the host offered it — which is the only evidence a page can have,
 * having no filesystem of its own — or it is spelled the one way nothing else
 * is spelled. A leading `/`, `./`, `../` or `~/` cannot be a hostname or a
 * search anybody meant.
 */
const isFile = (typed: string, offered: readonly string[]): boolean =>
  offered.includes(typed) ||
  offered.includes(underHome(typed)) ||
  /^(?:[/.]|~\/)/.test(typed);

/** A typed `~/` said in the terms the host answers in: relative to home. */
const underHome = (typed: string): string =>
  typed.startsWith("~/") ? typed.slice(2) : typed;

/** Whether somebody wrote a scheme down, in which case there is nothing to guess. */
const hasScheme = (typed: string): boolean =>
  /^[a-z][a-z\d+.-]*:\/\//i.test(typed);

/**
 * The endings that make a word a hostname rather than the end of a sentence.
 *
 * The launcher's own list rather than the public suffix list. A desktop that
 * recognised every TLD would read "the sentence ends. Then another" as a
 * request for a site in `.then`, and there is no shortage of registries whose
 * TLD is an ordinary English word. These are the ones this desktop's user
 * actually types, which is the same argument the shell script makes by
 * carrying a list of nine.
 */
const TLDS: readonly string[] = [
  "co",
  "com",
  "dev",
  "do",
  "edu",
  "gov",
  "io",
  "me",
  "net",
  "org",
  "sh",
  "xyz",
];

/**
 * Whether `typed` is a host, with or without a port and a path after it.
 *
 * `localhost` by name, because it is the one hostname with no dot in it that a
 * person types on purpose — and on a machine that is also a development box,
 * types constantly.
 */
const isHost = (typed: string): boolean => {
  const host = typed.split(/[/:?#]/)[0] ?? "";
  const tld = host.split(".").at(-1) ?? "";
  return (
    host === "localhost" ||
    (host.includes(".") && TLDS.includes(tld.toLowerCase()))
  );
};
