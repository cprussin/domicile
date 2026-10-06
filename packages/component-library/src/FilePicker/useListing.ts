import { useEffect, useState } from "react";

/** The status of a directory listing. */
export enum ListingState {
  Loading,
  Listed,
  Unreadable,
}

export const Listing = {
  /** The listed entries; subdirectory names end in `/`. */
  Listed: (entries: readonly string[]) => ({
    entries,
    state: ListingState.Listed as const,
  }),
  Loading: () => ({ state: ListingState.Loading as const }),
  /** The directory is missing or not readable. */
  Unreadable: () => ({ state: ListingState.Unreadable as const }),
};

export type Listing = ReturnType<(typeof Listing)[keyof typeof Listing]>;

/**
 * Lists `directory` whenever it changes.
 *
 * Drops results for a directory the picker has already left, since listings
 * can resolve out of order.
 */
export const useListing = (
  list: (path: string) => Promise<readonly string[]>,
  directory: string,
): Listing => {
  const [listing, setListing] = useState<Listing>(Listing.Loading());

  useEffect(() => {
    let current = true;
    setListing(Listing.Loading());
    list(directory)
      .then((entries) => {
        if (current) {
          setListing(Listing.Listed(entries));
        }
      })
      .catch((error: unknown) => {
        if (
          error instanceof DOMException &&
          error.name === "NotReadableError"
        ) {
          if (current) {
            setListing(Listing.Unreadable());
          }
        } else {
          // biome-ignore lint/suspicious/noConsole: reports an unexpected listing failure
          console.error("The file picker could not list a directory", error);
        }
      });
    return () => {
      current = false;
    };
  }, [list, directory]);

  return listing;
};
