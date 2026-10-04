import { useEffect, useState } from "react";

import { superseded } from "../host/superseded";
import type { FoundApps } from "./found-apps";

/**
 * The applications and bookmarks the host found for `query`, re-queried on
 * every change.
 *
 * Like `useFound` but without polling, since the host reads desktop entries
 * fresh each time. Stale answers are dropped.
 *
 * The empty query is never sent. It uses `opening` (see `useOpeningApps`),
 * fetched before the launcher opened, so the first rows don't shift in late.
 * `opening` is also shown until the first typed query is answered.
 */
export const useFoundApps = (
  searchApps: (query: string) => Promise<FoundApps>,
  query: string,
  opening: FoundApps,
): FoundApps => {
  const [found, setFound] = useState<FoundApps>(opening);

  useEffect(() => {
    let current = true;
    if (query !== "") {
      searchApps(query)
        .then(({ apps, bookmarks }) => {
          if (current) {
            setFound({ apps, bookmarks });
          }
        })
        .catch((error: unknown) => {
          // A newer search replaced this one, and is what the box is waiting on.
          if (!superseded(error)) {
            // biome-ignore lint/suspicious/noConsole: surfacing a search the host failed
            console.error("The host could not search the applications", error);
          }
        });
    }
    return () => {
      current = false;
    };
  }, [searchApps, query]);

  return query === "" ? opening : found;
};
