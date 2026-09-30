import type { FoundAppsMessage } from "@domicile/chrome-sdk/host-message";
import { useEffect, useState } from "react";

/** What a search for applications offers: the applications and bookmarks. */
export type FoundApps = Pick<FoundAppsMessage, "apps" | "bookmarks">;

/** What is offered before the host has answered. */
const NOTHING: FoundApps = { apps: [], bookmarks: [] };

/**
 * The applications and bookmarks the host found for `query`, asked for
 * whenever it changes.
 *
 * `useFound`'s shape without its asking again: the host reads the desktop
 * entries afresh for every question, so there is no half-built answer to
 * wait out. An answer to a query the box no longer says is dropped, for
 * `useFound`'s reason.
 */
export const useFoundApps = (
  searchApps: (query: string) => Promise<FoundAppsMessage>,
  query: string,
): FoundApps => {
  const [found, setFound] = useState<FoundApps>(NOTHING);

  useEffect(() => {
    let current = true;
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
    return () => {
      current = false;
    };
  }, [searchApps, query]);

  return found;
};
