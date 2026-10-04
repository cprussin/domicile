// The suggestions under a browser window's address bar.
//
// What Enter would do comes first, as in Chromium, then matching visits.
// Visits are only the addresses this shell sent the window to: the engine
// reports no address for links followed inside a guest (see ROADMAP.md).

import type { TypedAddress } from "./typed-address";
import { TypedAddressKind, typedAddress } from "./typed-address";

/** The most lines the list shows; lines past the first few are rarely used. */
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
 * The suggestions for `typed`, given the addresses `visited` (oldest first).
 *
 * An empty line offers recent visits only.
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

/** The typed line's own action as a suggestion. */
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
