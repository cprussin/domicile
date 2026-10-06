import type { DomicileFileSearch } from "@domicile-desktop/sdk/domicile-host";
import { useEffect, useState } from "react";

import { superseded } from "../host/superseded";

/**
 * How often to repeat a query while the host's index is still building.
 *
 * Indexing a home takes seconds and nothing signals new results, so the hook
 * polls. One second fills the list visibly without searching every frame.
 */
const ASK_AGAIN_MS = 1000;

/** The host's search result. */
export type Found = DomicileFileSearch;

/** The result before the host has answered. */
const NOTHING_YET: Found = { files: [], indexing: false, matched: 0 };

/**
 * The host's file search results for `query`, re-queried on every change.
 *
 * The compositor indexes home and returns only matches (see
 * `domicile_host::file_search`). Answers for a stale query are dropped, since
 * they can arrive out of order.
 *
 * Before the first answer the result is empty, not an error or "indexing". If
 * the compositor can't read home it never answers; the box still accepts a
 * path, URL or search.
 */
export const useFound = (
  search: (query: string) => Promise<Found>,
  query: string,
): Found => {
  const [found, setFound] = useState<Found>(NOTHING_YET);

  useEffect(() => {
    let current = true;
    let again: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      search(query)
        .then(({ files, indexing, matched }) => {
          if (current) {
            setFound({ files, indexing, matched });
            if (indexing) {
              again = setTimeout(ask, ASK_AGAIN_MS);
            }
          }
        })
        .catch((error: unknown) => {
          // A newer search replaced this one, and is what the box is waiting on.
          if (!superseded(error)) {
            // biome-ignore lint/suspicious/noConsole: surfacing a search the host failed
            console.error("The host could not search the home", error);
          }
        });
    };
    ask();
    return () => {
      current = false;
      clearTimeout(again);
    };
  }, [search, query]);

  return found;
};
