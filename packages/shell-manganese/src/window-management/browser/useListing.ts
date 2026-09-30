import { useEffect, useState } from "react";

/** Where a listing the picker asked for has got to. */
export enum ListingState {
  Loading,
  Listed,
  Unreadable,
}

export const Listing = {
  /** What the engine listed: a directory's name ends in `/`. */
  Listed: (entries: readonly string[]) => ({
    entries,
    state: ListingState.Listed as const,
  }),
  Loading: () => ({ state: ListingState.Loading as const }),
  /** Not a directory the browser can read — not there, or not ours. */
  Unreadable: () => ({ state: ListingState.Unreadable as const }),
};

export type Listing = ReturnType<(typeof Listing)[keyof typeof Listing]>;

/**
 * What is in `directory`, asked for whenever it changes — or nothing while
 * the box is a search rather than a path, and `directory` is `undefined`.
 *
 * An answer for a directory the box has left is dropped: typing moves faster
 * than the engine lists, and the engine owes the answers no order.
 */
export const useListing = (
  list: (path: string) => Promise<readonly string[]>,
  directory: string | undefined,
): Listing => {
  const [listing, setListing] = useState<Listing>(Listing.Listed([]));

  useEffect(() => {
    let current = true;
    if (directory === undefined) {
      setListing(Listing.Listed([]));
    } else {
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
            // biome-ignore lint/suspicious/noConsole: surfacing a listing the engine failed for a reason other than the directory
            console.error("The browser could not list a directory", error);
          }
        });
    }
    return () => {
      current = false;
    };
  }, [list, directory]);

  return listing;
};
