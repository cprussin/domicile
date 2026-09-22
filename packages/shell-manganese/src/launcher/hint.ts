// What Enter would do, in words, for a query no row has been chosen for.
//
// The launcher's list is files, so a query that matches none of them leaves a
// panel with nothing under the box — and what that panel is about to do on
// Enter is the one thing the user cannot see. This is that line.
//
// It is derived from `launchFor` rather than deciding anything of its own, so
// the words and the keystroke cannot disagree: a hint that said "Search for"
// over a box that would open a file is worse than no hint at all.

import { TypedAddressKind, typedAddress } from "../address/typed-address";
import { LaunchKind, launchFor } from "./launch";

/** Which of the three things the line is offering. */
export enum HintKind {
  Edit,
  Search,
  Site,
}

export const Hint = {
  Edit: (path: string) => ({ kind: HintKind.Edit as const, path }),
  /**
   * The words, not the URL they would become. What the address bar offers for
   * the same line and for the same reason: answering "kate bush" with
   * `google.com/search?q=kate%20bush` tells the user their query has turned
   * into a URL they now have to read.
   */
  Search: (query: string) => ({ kind: HintKind.Search as const, query }),
  Site: (url: string) => ({ kind: HintKind.Site as const, url }),
};

export type Hint = ReturnType<(typeof Hint)[keyof typeof Hint]>;

/**
 * What to say about `query`, given what the host said there is to open, and
 * `undefined` for a box with nothing in it — which is a box Enter does
 * nothing for, and so a box with nothing to promise.
 */
export const hintFor = (
  query: string,
  offered: readonly string[],
): Hint | undefined => {
  const launched = launchFor(query, offered);
  if (launched === undefined) {
    return undefined;
  } else {
    switch (launched.kind) {
      case LaunchKind.Browsed: {
        return browsed(query, launched.url);
      }
      case LaunchKind.Edited: {
        return Hint.Edit(launched.path);
      }
    }
  }
};

/** A site or a search: the one distinction `launchFor` does not draw. */
const browsed = (query: string, url: string): Hint => {
  const address = typedAddress(query);
  return address?.kind === TypedAddressKind.Search
    ? Hint.Search(address.query)
    : Hint.Site(url);
};
