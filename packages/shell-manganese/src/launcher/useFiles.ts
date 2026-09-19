import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useEffect, useState } from "react";

/**
 * What there is to open, asked for whenever the launcher opens.
 *
 * **Asked rather than subscribed to.** A file created in a terminal is not an
 * event any part of this desktop sees — nothing watches a home directory — so
 * a list fetched once at startup would be yesterday's by the afternoon, and a
 * list the compositor pushed would need a watch on a tree that can have a
 * hundred thousand files in it. The panel is open for a few seconds at a time,
 * which is exactly when the answer has to be current.
 *
 * The empty list before the host has answered is not a failure state and is
 * not drawn as one: a launcher with no rows looks the same as a home with
 * nothing in it, and either way the box still takes a URL or a query. A home
 * the compositor could not read produces no answer at all, deliberately — see
 * `domicile_host::files`.
 */
export const useFiles = (
  domicile: DomicileClient,
  open: boolean,
): readonly string[] => {
  const [files, setFiles] = useState<readonly string[]>([]);

  // Registered once and for the life of the shell, rather than when the panel
  // opens: `on` is a single slot whose hold delivers whatever arrived before
  // it, and a handler that came and went with the panel would be handing that
  // hold back an answer at a time.
  useEffect(() => {
    domicile.on("files", (message) => {
      setFiles(message.files);
    });
  }, [domicile]);

  useEffect(() => {
    if (open) {
      domicile.listFiles();
    }
  }, [domicile, open]);

  return files;
};
