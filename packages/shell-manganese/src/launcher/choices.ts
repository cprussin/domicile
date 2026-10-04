// The launcher's rows for a query. Each row is an action Enter can take.
//
// Order:
// 1. The page a `!` tag's site has for the words, if any.
// 2. The tagged search, if the query has a tag.
// 3. A site, if the query is a URL. A full URL is almost always meant as one.
// 4. Matching applications and bookmarks, as one list.
// 5. A path, if the query is spelled like one.
// 6. Matching files. Applications rank above files because they are asked
//    for more often.
// 7. A Google search for the query, always, as the fallback.
//
// `typedAddress` decides site vs. search, so this box and a browser window's
// address bar agree.

import type {
  Bookmark,
  DesktopEntry,
} from "@domicile-desktop/sdk/host-message";

import type { TaggedSearch, TaggedSite } from "../address/search";
import { googleUrl, taggedSearch, taggedSite } from "../address/search";
import { TypedAddressKind, typedAddress } from "../address/typed-address";
import { fileRow } from "./file-row";
import { Launch } from "./launch";

/** The kind of a launcher row. */
export enum ChoiceKind {
  App,
  Bookmark,
  File,
  Site,
  Search,
  TaggedSearch,
  TaggedSite,
}

export const Choice = {
  /** An application from a desktop entry. */
  App: (entry: DesktopEntry) => ({
    entry,
    kind: ChoiceKind.App as const,
  }),
  /** A bookmark. */
  Bookmark: (bookmark: Bookmark) => ({
    kind: ChoiceKind.Bookmark as const,
    ...bookmark,
  }),
  /** A path. A directory ends in `/`. */
  File: (found: string) => ({
    kind: ChoiceKind.File as const,
    row: fileRow(found),
  }),
  /**
   * A web search. The row shows the words rather than the search URL, which
   * is harder to read.
   */
  Search: (query: string, url: string) => ({
    kind: ChoiceKind.Search as const,
    query,
    url,
  }),
  Site: (url: string) => ({ kind: ChoiceKind.Site as const, url }),
  /** A search on the site a tag names. */
  TaggedSearch: (search: TaggedSearch) => ({
    kind: ChoiceKind.TaggedSearch as const,
    ...search,
  }),
  /** The page on a tag's site whose name is the words. */
  TaggedSite: (site: TaggedSite) => ({
    kind: ChoiceKind.TaggedSite as const,
    ...site,
  }),
};

export type Choice = ReturnType<(typeof Choice)[keyof typeof Choice]>;

/**
 * The rows for `query`, given what the host found for it.
 *
 * A tagged query puts the tag's page and search first, since the tag says
 * where the user meant to go. The rows for the line as typed follow, with a
 * Google search rather than a second search on the tag's engine.
 */
export const choicesFor = (
  query: string,
  found: readonly string[],
  apps: readonly DesktopEntry[],
  bookmarks: readonly Bookmark[],
): Choice[] => {
  const site = taggedSite(query);
  const tagged = taggedSearch(query);
  return [
    ...(site === undefined ? [] : [Choice.TaggedSite(site)]),
    ...(tagged === undefined ? [] : [Choice.TaggedSearch(tagged)]),
    ...plainChoicesFor(query, found, apps, bookmarks),
  ];
};

/** The launch for `choice`. */
export const launchOf = (choice: Choice): Launch => {
  switch (choice.kind) {
    case ChoiceKind.App: {
      return Launch.Ran(choice.entry.command);
    }
    case ChoiceKind.File: {
      return Launch.Opened(choice.row.path);
    }
    case ChoiceKind.Bookmark:
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
  apps: readonly DesktopEntry[],
  bookmarks: readonly Bookmark[],
): Choice[] => {
  const typed = query.trim();
  const address = typedAddress(typed);
  const applications = byName(typed, [
    ...apps.map((entry) => Choice.App(entry)),
    ...bookmarks.map((bookmark) => Choice.Bookmark(bookmark)),
  ]);
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
 * Applications and bookmarks merged and ranked as the host ranks each: prefix
 * matches first, then by name. The sort is stable, so equal names keep the
 * host's order.
 */
const byName = (
  typed: string,
  choices: readonly (
    | ReturnType<typeof Choice.App>
    | ReturnType<typeof Choice.Bookmark>
  )[],
): Choice[] => {
  const prefix = typed.toLowerCase();
  return choices
    .map((choice) => ({ choice, name: nameOf(choice).toLowerCase() }))
    .toSorted(
      (a, b) =>
        Number(!a.name.startsWith(prefix)) -
          Number(!b.name.startsWith(prefix)) || compared(a.name, b.name),
    )
    .map(({ choice }) => choice);
};

/** Compare by UTF-16 code unit, as the host does. */
const compared = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  } else {
    return a > b ? 1 : 0;
  }
};

const nameOf = (
  choice: ReturnType<typeof Choice.App> | ReturnType<typeof Choice.Bookmark>,
): string => {
  switch (choice.kind) {
    case ChoiceKind.App: {
      return choice.entry.name;
    }
    case ChoiceKind.Bookmark: {
      return choice.name;
    }
  }
};

/**
 * A row for a query that starts with `/`, `./`, `../` or `~/`, unless the host
 * already found that path.
 *
 * Such a query can't be a hostname or a search. It is needed because the host
 * only searches home, so `/etc/hosts` would otherwise be missing.
 */
const typedPath = (typed: string, found: readonly string[]): Choice[] => {
  const path = typed.startsWith("~/") ? typed.slice(2) : typed;
  const isFound = found.some((each) => fileRow(each).path === path);
  return /^(?:[/.]|~\/)/.test(typed) && !isFound ? [Choice.File(path)] : [];
};
