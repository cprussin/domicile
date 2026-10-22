import { createHandle } from "@domicile-desktop/component-library/Popover";
import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { watchHost } from "@domicile-desktop/manganese-host/watch-host";

import { messagesFrom } from "./from-messages";
import type { PageBars } from "./page-bars";
import { pageBars } from "./page-bars";

/** What every bar's item shares. */
export type DeskMessages = {
  bars: PageBars;
  /** Opens the one panel from any bar's item. */
  handle: ReturnType<typeof createHandle>;
  /** The ids of Messages' uncleared notifications. */
  notifications: SharedWatch<readonly number[]>;
};

/** The item's shared state, once per desktop. */
export const deskMessages = perHost(
  (domicile): DeskMessages => ({
    bars: pageBars(),
    handle: createHandle(),
    notifications: sharedWatch((onIds: (ids: readonly number[]) => void) =>
      watchHost(
        domicile,
        "notificationschanged",
        (host) => host.notifications ?? undefined,
        (items) => {
          onIds(messagesFrom(items));
        },
      ),
    ),
  }),
);
