// The rows the launcher offers for what was typed into it.
//
// Every row is a thing Enter can do, so the list is the whole answer to "what
// will this do" — there is no second line under it saying so. In order: the
// page a `!` tag's site has for the words, if it has one; the search the tag
// names, if the box carries one; a site, if the box holds one; the
// applications the host found; a path, if it is spelled like one; the files
// the host found; and a search on Google for the line as typed, always. A URL
// typed whole is a URL meant, so it goes on top; an application is above a
// file, because a launcher is asked for one far more often; the search goes
// last, because it is what is left when nothing above it was.
//
// `typedAddress` is the one place that decides whether a line is a site or a
// search: a desktop where this box and a browser window's address bar
// disagree about `localhost:5173` is one where the user has to remember which
// box they are in.

import type { DomicileDesktopEntry } from "@domicile/chrome-sdk/domicile-host";

import type { TaggedSearch, TaggedSite } from "../address/search";
import { googleUrl, taggedSearch, taggedSite } from "../address/search";
import { TypedAddressKind, typedAddress } from "../address/typed-address";
import { fileRow } from "./file-row";
import { Launch } from "./launch";

/** Which of the six kinds of row a choice is. */
export enum ChoiceKind {
  App,
  File,
  Site,
  Search,
  TaggedSearch,
  TaggedSite,
}

export const Choice = {
  /** An application a desktop entry offers, as the host found it. */
  App: (entry: DomicileDesktopEntry) => ({
    entry,
    kind: ChoiceKind.App as const,
  }),
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
  /** The words, on the site their tag named. */
  TaggedSearch: (search: TaggedSearch) => ({
    kind: ChoiceKind.TaggedSearch as const,
    ...search,
  }),
  /** The page on the site a tag named that the words are the name of. */
  TaggedSite: (site: TaggedSite) => ({
    kind: ChoiceKind.TaggedSite as const,
    ...site,
  }),
};

export type Choice = ReturnType<(typeof Choice)[keyof typeof Choice]>;

/**
 * The rows for `query`, given the files and applications the host found for
 * it.
 *
 * A tagged query gets its tagged search on top — the tag is the user saying
 * where they meant to go — with the page the words name there above it, if
 * they name one. Below them are the rows the line gets as typed, its search
 * on Google rather than a second row for the tag's engine.
 */
export const choicesFor = (
  query: string,
  found: readonly string[],
  apps: readonly DomicileDesktopEntry[],
): Choice[] => {
  const site = taggedSite(query);
  const tagged = taggedSearch(query);
  return [
    ...(site === undefined ? [] : [Choice.TaggedSite(site)]),
    ...(tagged === undefined ? [] : [Choice.TaggedSearch(tagged)]),
    ...plainChoicesFor(query, found, apps),
  ];
};

/** What choosing `choice` launches. */
export const launchOf = (choice: Choice): Launch => {
  switch (choice.kind) {
    case ChoiceKind.App: {
      return Launch.Ran(choice.entry.command);
    }
    case ChoiceKind.File: {
      return Launch.Opened(choice.row.path);
    }
    case ChoiceKind.Site:
    case ChoiceKind.Search:
    case ChoiceKind.TaggedSearch:
    case ChoiceKind.TaggedSite: {
      return Launch.Browsed(choice.url);
    }
  }
};

const plainChoicesFor = (
  query: string,
  found: readonly string[],
  apps: readonly DomicileDesktopEntry[],
): Choice[] => {
  const typed = query.trim();
  const address = typedAddress(typed);
  const applications = apps.map((entry) => Choice.App(entry));
  const files = found.map((path) => Choice.File(path));
  return address === undefined
    ? [...applications, ...files]
    : [
        ...(address.kind === TypedAddressKind.Site
          ? [Choice.Site(address.url)]
          : []),
        ...applications,
        ...typedPath(typed, found),
        ...files,
        Choice.Search(typed, googleUrl(typed)),
      ];
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
