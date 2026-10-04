import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { ClipboardMessage } from "@domicile-desktop/sdk/host-message";
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
  domicile: DomicileClient,
): ClipboardMessage["entries"] => {
  const [entries, setEntries] = useState<ClipboardMessage["entries"]>([]);

  // Registered once for the shell's life, not per panel open: `on` has a single
  // slot and replays the last message to a new handler.
  useEffect(() => {
    domicile.on("clipboard", (message) => {
      setEntries(message.entries);
    });
  }, [domicile]);

  return entries;
};
