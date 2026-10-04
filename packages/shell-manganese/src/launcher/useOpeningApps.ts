import { useEffect, useRef, useState } from "react";

import { superseded } from "../host/superseded";
import type { FoundApps } from "./found-apps";

/** The result before the host has answered. */
const NOTHING: FoundApps = { apps: [], bookmarks: [] };

/**
 * The applications and bookmarks for the launcher's empty query, fetched
 * before it opens.
 *
 * Fetched at startup and on every close, not on open, so rows don't shift in
 * after the panel appears. Refetching on close picks up newly installed apps.
 */
export const useOpeningApps = (
  searchApps: (query: string) => Promise<FoundApps>,
  open: boolean,
): FoundApps => {
  const [found, setFound] = useState<FoundApps>(NOTHING);
  // Request counter, so an older answer never replaces a newer one. Not an
  // effect cleanup, because opening the launcher must not cancel the request
  // made on close.
  const latest = useRef(0);

  useEffect(() => {
    if (!open) {
      latest.current += 1;
      const ask = latest.current;
      searchApps("")
        .then(({ apps, bookmarks }) => {
          if (ask === latest.current) {
            setFound({ apps, bookmarks });
          }
        })
        .catch((error: unknown) => {
          // A search typed into the open launcher replaced this one. These
          // rows are requested again when it closes.
          if (!superseded(error)) {
            // biome-ignore lint/suspicious/noConsole: surfacing a search the host failed
            console.error("The host could not search the applications", error);
          }
        });
    }
  }, [searchApps, open]);

  return found;
};
