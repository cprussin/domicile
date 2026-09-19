// What an address bar offers under itself while it is being typed into.
//
// Two kinds of line, and the order between them is the design: what Enter
// would do comes first, and where the window has been comes after it. The list
// is a list of alternatives to the thing the user is already halfway to doing,
// so the thing they are doing has to be on it — at the top, which is where
// Chromium puts it and where the eye is already looking.
//
// WHERE THE WINDOW HAS BEEN IS WHERE THE SHELL SENT IT. A browser's own
// suggestions come out of a history of pages that actually loaded; the engine
// reports no address for a guest — see ROADMAP.md — so what there is to
// suggest is the addresses this shell asked for. A link followed inside the
// page is not one of them.

import type { TypedAddress } from "./typed-address";
import { TypedAddressKind, typedAddress } from "./typed-address";

/**
 * How many lines the list can grow to.
 *
 * A list longer than this is not a suggestion, and the lines past the first
 * few are never the answer — an address bar that offered a whole history would
 * be a history with a text box on top.
 */
const MOST = 6;

/** Which kind of line a suggestion is. */
export enum AddressSuggestionKind {
  Site,
  Search,
  Visited,
}

export const AddressSuggestion = {
  /** Words, and where they would be searched for. */
  Search: (query: string, url: string) => ({
    kind: AddressSuggestionKind.Search as const,
    query,
    url,
  }),
  /** The address the typed line would load. */
  Site: (url: string) => ({ kind: AddressSuggestionKind.Site as const, url }),
  /** Somewhere this window has already been sent. */
  Visited: (url: string) => ({
    kind: AddressSuggestionKind.Visited as const,
    url,
  }),
};

export type AddressSuggestion = ReturnType<
  (typeof AddressSuggestion)[keyof typeof AddressSuggestion]
>;

/**
 * What to offer for `typed`, given the addresses `visited` this window has
 * been sent to — oldest first, which is the order they are kept in.
 *
 * An empty line offers the visits alone: a bar that has just been focused is a
 * user about to go back somewhere, not a user about to search for nothing.
 */
export const addressSuggestions = (
  typed: string,
  visited: readonly string[],
): readonly AddressSuggestion[] => {
  const typedAction = typedAddress(typed);
  const recent = [...visited].reverse();
  if (typedAction === undefined) {
    return recent.slice(0, MOST).map(AddressSuggestion.Visited);
  } else {
    const matching = recent
      .filter(
        (url) =>
          url !== typedAction.url &&
          url.toLowerCase().includes(typed.trim().toLowerCase()),
      )
      .map(AddressSuggestion.Visited);
    return [suggestionFor(typedAction), ...matching].slice(0, MOST);
  }
};

/** The typed line's own answer, as a line of the list. */
const suggestionFor = (action: TypedAddress): AddressSuggestion => {
  switch (action.kind) {
    case TypedAddressKind.Site: {
      return AddressSuggestion.Site(action.url);
    }
    case TypedAddressKind.Search: {
      return AddressSuggestion.Search(action.query, action.url);
    }
  }
};
