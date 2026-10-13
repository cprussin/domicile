import { useEffect, useState } from "react";

import type { FoundApps } from "./found-apps";

/**
 * The applications and bookmarks matching `query`, searched again on every
 * change. Stale answers are dropped.
 *
 * The empty query is never searched. It uses `opening` (see
 * `useOpeningApps`), read before the launcher opened, so the first rows don't
 * shift in late. `opening` is also shown until the first typed query is
 * answered.
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
          // biome-ignore lint/suspicious/noConsole: surfacing a search that failed
          console.error("Could not search the applications", error);
        });
    }
    return () => {
      current = false;
    };
  }, [searchApps, query]);

  return query === "" ? opening : found;
};
