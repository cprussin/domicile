import { useEffect, useState } from "react";

import type { Folders } from "./folders";

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
 * Lists `directory` whenever it changes, and again whenever its entries
 * change.
 *
 * Drops results for a directory the picker has already left, since listings
 * can resolve out of order. Watches a directory once it is listed, and lists
 * one at a time: changes heard during a listing list it once more after.
 */
export const useListing = (folders: Folders, directory: string): Listing => {
  const [listing, setListing] = useState<Listing>(Listing.Loading());

  useEffect(() => {
    const browsing: Browsing = {
      current: true,
      listing: false,
      stale: false,
      unwatch: undefined,
    };
    const list = () => {
      browsing.listing = true;
      folders
        .list(directory)
        .then((entries) => {
          if (browsing.current) {
            setListing(Listing.Listed(entries));
            browsing.unwatch ??= folders.watch(directory, () => {
              if (browsing.listing) {
                browsing.stale = true;
              } else {
                list();
              }
            });
          }
        })
        .catch((error: unknown) => {
          if (
            error instanceof DOMException &&
            error.name === "NotReadableError"
          ) {
            if (browsing.current) {
              setListing(Listing.Unreadable());
            }
          } else {
            // biome-ignore lint/suspicious/noConsole: reports an unexpected listing failure
            console.error("The file picker could not list a directory", error);
          }
        })
        .finally(() => {
          browsing.listing = false;
          if (browsing.stale && browsing.current) {
            browsing.stale = false;
            list();
          }
        });
    };
    setListing(Listing.Loading());
    list();
    return () => {
      browsing.current = false;
      browsing.unwatch?.();
    };
  }, [folders, directory]);

  return listing;
};

/** One directory's listings, while it is browsed. */
type Browsing = {
  /** Whether the picker is still in the directory. */
  current: boolean;
  /** Whether a listing is running. */
  listing: boolean;
  /** Whether it changed during the running listing. */
  stale: boolean;
  unwatch: (() => void) | undefined;
};
