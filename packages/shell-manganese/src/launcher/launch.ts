// What the launcher does with what was typed into it.
//
// Three answers in the order `run` decides them in the launcher this desktop
// is modelled on: a file, then a site, then a search. The order is the whole
// of the design — every query is a search if nothing better claims it first,
// so the two claims above it have to be the ones that can be made confidently.
//
// The evidence is different in each case, which is why they are ranked rather
// than pattern-matched independently. A file is either one the host listed —
// evidence, not a guess — or a path spelled in a way nothing else is. What is
// left is a web address, and `typedAddress` is the one place that decides
// whether that is a site or a search: a desktop where this box and a browser
// window's address bar disagree about `localhost:5173` is one where the user
// has to remember which box they are in.

import { typedAddress } from "../address/typed-address";

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
  // Asked first, and not because a web address outranks a file — it does not,
  // and the branches below are still in the order they are decided in. It is
  // asked first because the one line it answers nothing for is the empty one,
  // which is the same line this function answers nothing for.
  const address = typedAddress(typed);
  if (address === undefined) {
    return undefined;
  } else if (isFile(typed, offered)) {
    return Launch.Edited(underHome(typed));
  } else {
    return Launch.Browsed(address.url);
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
