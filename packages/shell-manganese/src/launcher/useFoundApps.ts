import type { FoundAppsMessage } from "@domicile-desktop/sdk/host-message";
import { useEffect, useState } from "react";

/** Applications and bookmarks found for a query. */
export type FoundApps = Pick<FoundAppsMessage, "apps" | "bookmarks">;

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
  searchApps: (query: string) => Promise<FoundAppsMessage>,
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
          // biome-ignore lint/suspicious/noConsole: surfacing a search the host failed
          console.error("The host could not search the applications", error);
        });
    }
    return () => {
      current = false;
    };
  }, [searchApps, query]);

  return query === "" ? opening : found;
};
