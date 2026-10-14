import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";

import type { Inbox } from "./inbox";
import { inboxReader } from "./read-inbox";
import { watchInbox } from "./watch-inbox";

/**
 * Each account's inbox, watched once for every bar on the desk. Paused while
 * the desk is locked, which refuses the reads.
 */
export const deskInbox = perHost((domicile) => {
  const watches = new Map<string, SharedWatch<Inbox>>();
  return (email: string): SharedWatch<Inbox> => {
    const known = watches.get(email);
    if (known === undefined) {
      const watch = sharedWatch((onInbox: (inbox: Inbox) => void) =>
        watchInbox(
          inboxReader(domicile, email),
          onInbox,
          () => domicile.locked === true,
        ),
      );
      watches.set(email, watch);
      return watch;
    } else {
      return known;
    }
  };
});
