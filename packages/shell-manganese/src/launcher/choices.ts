// The rows the launcher offers for what was typed into it.
//
// Every row is a thing Enter can do, so the list is the whole answer to "what
// will this do" — there is no second line under it saying so. In order: a
// site, if the box holds one; a path, if it is spelled like one; the files the
// host found; and a search, always. A URL typed whole is a URL meant, so it
// goes on top; the search goes last, because it is what is left when nothing
// above it was.
//
// `typedAddress` is the one place that decides whether a line is a site or a
// search: a desktop where this box and a browser window's address bar
// disagree about `localhost:5173` is one where the user has to remember which
// box they are in.

import { searchUrl } from "../address/search";
import { TypedAddressKind, typedAddress } from "../address/typed-address";
import { fileRow } from "./file-row";
import { Launch } from "./launch";

/** Which of the three kinds of row a choice is. */
export enum ChoiceKind {
  File,
  Site,
  Search,
}

export const Choice = {
  /** A path, as the host named it: a directory ends in `/`. */
  File: (found: string) => ({
    kind: ChoiceKind.File as const,
    row: fileRow(found),
  }),
  /**
   * The words, and where they go. The row says the words, not the URL they
   * would become: answering "kate bush" with `google.com/search?q=kate%20bush`
   * tells the user their query has turned into a URL they now have to read.
   */
  Search: (query: string, url: string) => ({
    kind: ChoiceKind.Search as const,
    query,
    url,
  }),
  Site: (url: string) => ({ kind: ChoiceKind.Site as const, url }),
};

export type Choice = ReturnType<(typeof Choice)[keyof typeof Choice]>;

/** The rows for `query`, given what the host found for it. */
export const choicesFor = (
  query: string,
  found: readonly string[],
): Choice[] => {
  const typed = query.trim();
  const address = typedAddress(typed);
  const files = found.map((path) => Choice.File(path));
  return address === undefined
    ? files
    : [
        ...(address.kind === TypedAddressKind.Site
          ? [Choice.Site(address.url)]
          : []),
        ...typedPath(typed, found),
        ...files,
        Choice.Search(typed, searchUrl(typed)),
      ];
};

/** What choosing `choice` launches. */
export const launchOf = (choice: Choice): Launch => {
  switch (choice.kind) {
    case ChoiceKind.File: {
      return Launch.Edited(choice.row.path);
    }
    case ChoiceKind.Site:
    case ChoiceKind.Search: {
      return Launch.Browsed(choice.url);
    }
  }
};

/**
 * The row for a path spelled the one way nothing else is, unless the host
 * already found it.
 *
 * A leading `/`, `./`, `../` or `~/` cannot be a hostname or a search anybody
 * meant, and the host's list is what a home has in it rather than what exists:
 * `/etc/hosts` is not under home and is still a file.
 */
const typedPath = (typed: string, found: readonly string[]): Choice[] => {
  const path = typed.startsWith("~/") ? typed.slice(2) : typed;
  const isFound = found.some((each) => fileRow(each).path === path);
  return /^(?:[/.]|~\/)/.test(typed) && !isFound ? [Choice.File(path)] : [];
};
