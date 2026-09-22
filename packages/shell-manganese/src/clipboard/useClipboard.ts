import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { ClipboardMessage } from "@domicile/chrome-sdk/host-message";
import { useEffect, useState } from "react";

/**
 * What has been copied on this desktop, newest first.
 *
 * **Pushed rather than asked for**, which is the opposite of `useFiles` and
 * for the opposite reason: a copy is `wl_data_device.set_selection` arriving
 * at the compositor, which is an event it already hears, where a file
 * appearing in a home directory is not an event anything on this desktop sees.
 * So there is nothing to ask and nothing to ask on — a panel that fetched on
 * opening would be fetching what it has already been told.
 *
 * **Not `navigator.clipboard`, which is the trap that looks like this.** That
 * API answers out of the browser's own clipboard, which on the platform this
 * engine scans out on is connected to no Wayland client at all: a shell
 * reading it would see what the shell itself copied and nothing any window
 * did.
 *
 * The empty list before the compositor has said anything is not a failure
 * state and is not drawn as one — it is also what a desktop nothing has been
 * copied on says, which is the ordinary state of one that has just started,
 * since the history is in memory and never on disk.
 */
export const useClipboard = (
  domicile: DomicileClient,
): ClipboardMessage["entries"] => {
  const [entries, setEntries] = useState<ClipboardMessage["entries"]>([]);

  // Registered once and for the life of the shell, rather than when the panel
  // opens: `on` is a single slot whose hold delivers whatever arrived before
  // it, and a handler that came and went with the panel would be handing that
  // hold back a history at a time.
  useEffect(() => {
    domicile.on("clipboard", (message) => {
      setEntries(message.entries);
    });
  }, [domicile]);

  return entries;
};
