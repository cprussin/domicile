import type { FoundAppsMessage } from "@domicile/chrome-sdk/host-message";
import { useEffect, useRef, useState } from "react";

import type { FoundApps } from "./useFoundApps";

/** What is offered before the host has answered. */
const NOTHING: FoundApps = { apps: [], bookmarks: [] };

/**
 * The applications and bookmarks the launcher's empty box offers, found before
 * it is opened.
 *
 * Asked while the launcher is shut — as the desk starts, and again each time
 * it is put away — rather than as it opens: an answer that landed after the
 * panel did would push every row under it down a moment after the panel
 * appeared. Asked again on every close because the host reads the desktop
 * entries afresh for every question, so what was installed since the last
 * open is there by the next one.
 */
export const useOpeningApps = (
  searchApps: (query: string) => Promise<FoundAppsMessage>,
  open: boolean,
): FoundApps => {
  const [found, setFound] = useState<FoundApps>(NOTHING);
  // Which ask is the latest, so an older answer never replaces a newer one.
  // Counted rather than dropped in an effect's cleanup, because opening the
  // launcher is not a newer ask: what was asked as it was shut still stands.
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
          // biome-ignore lint/suspicious/noConsole: surfacing a search the host failed
          console.error("The host could not search the applications", error);
        });
    }
  }, [searchApps, open]);

  return found;
};
