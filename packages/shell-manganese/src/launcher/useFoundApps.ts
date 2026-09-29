import type {
  DesktopEntry,
  FoundAppsMessage,
} from "@domicile/chrome-sdk/host-message";
import { useEffect, useState } from "react";

/**
 * The applications the host found for `query`, asked for whenever it changes.
 *
 * `useFound`'s shape without its asking again: the host reads the desktop
 * entries afresh for every question, so there is no half-built answer to
 * wait out. An answer to a query the box no longer says is dropped, for
 * `useFound`'s reason.
 */
export const useFoundApps = (
  searchApps: (query: string) => Promise<FoundAppsMessage>,
  query: string,
): readonly DesktopEntry[] => {
  const [apps, setApps] = useState<readonly DesktopEntry[]>([]);

  useEffect(() => {
    let current = true;
    searchApps(query)
      .then((found) => {
        if (current) {
          setApps(found.apps);
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

  return apps;
};
