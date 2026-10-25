import { watchHost } from "@domicile-desktop/manganese-host/watch-host";
import type { ClipboardEntry } from "@domicile-desktop/sdk/desktop/clipboard";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { useEffect, useState } from "react";

/**
 * The clipboard history, newest first.
 *
 * Pushed by the compositor, which sees every `wl_data_device.set_selection`,
 * so there is nothing to request. `navigator.clipboard` is no substitute: it
 * gives only the current entry, behind a permission prompt.
 *
 * The list starts empty, which is also the normal state after startup since
 * the history is kept only in memory.
 */
export const useClipboard = (
  domicile: Pick<Domicile, "clipboard">,
): readonly ClipboardEntry[] => {
  const [entries, setEntries] = useState<readonly ClipboardEntry[]>([]);

  useEffect(() => {
    const { clipboard } = domicile;
    return watchHost(
      (changed) => clipboard.on("change", changed),
      () => clipboard.entries,
      setEntries,
    );
  }, [domicile]);

  return entries;
};
