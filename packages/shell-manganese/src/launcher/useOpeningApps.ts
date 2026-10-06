import { useEffect, useRef, useState } from "react";

import type { FoundApps } from "./found-apps";

/** The result before the first read has finished. */
const NOTHING: FoundApps = { apps: [], bookmarks: [] };

/**
 * The applications and bookmarks for the launcher's empty query, read before
 * it opens.
 *
 * Read at startup and on every close, not on open, so rows don't shift in
 * after the panel appears. Reading on close picks up newly installed apps.
 */
export const useOpeningApps = (
  opening: () => Promise<FoundApps>,
  open: boolean,
): FoundApps => {
  const [found, setFound] = useState<FoundApps>(NOTHING);
  // Request counter, so an older answer never replaces a newer one. Not an
  // effect cleanup, because opening the launcher must not cancel the read
  // made on close.
  const latest = useRef(0);

  useEffect(() => {
    if (!open) {
      latest.current += 1;
      const ask = latest.current;
      opening()
        .then(({ apps, bookmarks }) => {
          if (ask === latest.current) {
            setFound({ apps, bookmarks });
          }
        })
        .catch((error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: surfacing a read that failed
          console.error("Could not read the installed applications", error);
        });
    }
  }, [opening, open]);

  return found;
};
