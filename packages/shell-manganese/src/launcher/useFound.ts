import type { FoundFilesMessage } from "@domicile/chrome-sdk/host-message";
import { useEffect, useState } from "react";

/**
 * How long an answer from a half-built index stands before it is asked again.
 *
 * The walk of a real home takes seconds, and nothing tells this page when it
 * has found more — so while the host says it is still looking, the question is
 * put again on this clock. A second is a panel that visibly fills in, and not
 * a search per frame.
 */
const ASK_AGAIN_MS = 1000;

/** What the host found for the box, less the query it answered. */
export type Found = Omit<FoundFilesMessage, "query">;

/** What a launcher has found before the host has answered anything. */
const NOTHING_YET: Found = { files: [], indexing: false, matched: 0 };

/**
 * What the host found for `query`, asked for whenever it changes.
 *
 * **The host searches and the page draws.** The compositor's index is the
 * whole home, and all that crosses into this page is what one query matched —
 * see `domicile_host::file_search`. So every keystroke is a question, and the
 * rows are the latest answer.
 *
 * An answer to a query the box no longer says is dropped: two searches are in
 * flight whenever somebody types faster than the host answers, and the host
 * owes them no order.
 *
 * The rows before the first answer are none, which is not drawn as a failure
 * or as an index being built — neither has been said yet. A home the
 * compositor could not read is never answered at all, deliberately; the box
 * still takes a path, a URL or a query.
 */
export const useFound = (
  search: (query: string) => Promise<FoundFilesMessage>,
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
          // biome-ignore lint/suspicious/noConsole: surfacing a search the host failed
          console.error("The host could not search the home", error);
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
