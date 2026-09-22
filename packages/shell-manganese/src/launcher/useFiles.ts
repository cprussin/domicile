import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useEffect, useState } from "react";

/** What there is to open, and whether that is all of it yet. */
type Offered = {
  files: readonly string[];
  /**
   * Whether the compositor is still walking the home this list came out of.
   *
   * What the panel draws its "still building" line from. A launcher cannot
   * work it out: a short list from a half-built index and a short list from a
   * small home look identical.
   */
  indexing: boolean;
};

/**
 * What there is to open, asked for when the launcher opens and pushed after.
 *
 * **Both, and each covers what the other cannot.** The compositor keeps an
 * index of the home — see `domicile_host::file_index` — and broadcasts it
 * whenever it changes, which is what fills a panel in under the person typing
 * into it while the startup walk finishes. But a broadcast only reaches the
 * pages that were connected for it, and a page that has just reloaded has
 * heard none of them, so opening the panel also asks.
 *
 * The empty list before the host has answered is not a failure state and is
 * not drawn as one: a launcher with no rows looks the same as a home with
 * nothing in it, and either way the box still takes a URL or a query. Nor is
 * it drawn as an index being built, which is a claim nothing has made yet. A
 * home the compositor could not read produces no answer at all, deliberately —
 * see `domicile_host::home_walk`.
 */
export const useFiles = (domicile: DomicileClient, open: boolean): Offered => {
  const [offered, setOffered] = useState<Offered>({
    files: [],
    indexing: false,
  });

  // Registered once and for the life of the shell, rather than when the panel
  // opens: `on` is a single slot whose hold delivers whatever arrived before
  // it, and a handler that came and went with the panel would be handing that
  // hold back an answer at a time. It is also what makes a panel that is
  // already up fill in as the index does.
  useEffect(() => {
    domicile.on("files", (message) => {
      setOffered({ files: message.files, indexing: message.indexing });
    });
  }, [domicile]);

  useEffect(() => {
    if (open) {
      domicile.listFiles();
    }
  }, [domicile, open]);

  return offered;
};
