import { useEffect, useState } from "react";

import { superseded } from "../host/superseded";
import type { FoundApps } from "./found-apps";

/**
 * The applications and bookmarks the host found for `query`, asked for
 * whenever it changes.
 *
 * `useFound`'s shape without its asking again: the host reads the desktop
 * entries afresh for every question, so there is no half-built answer to
 * wait out. An answer to a query the box no longer says is dropped, for
 * `useFound`'s reason.
 *
 * **The empty box is never asked.** Its answer is `opening`, found by the
 * desk before the launcher opened — see `useOpeningApps` — so the rows a
 * launcher opens onto are drawn with it rather than a round trip later,
 * pushing everything below them down as they land. It is also what is drawn
 * until the first thing typed is answered.
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
