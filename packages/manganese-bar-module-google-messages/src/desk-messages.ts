import { createHandle } from "@domicile-desktop/component-library/Popover";
import { perHost } from "@domicile-desktop/manganese-host/per-host";

import type { PageBars } from "./page-bars";
import { pageBars } from "./page-bars";
import type { UnreadCount } from "./unread-count";
import { unreadCount } from "./unread-count";

/** What every bar's item shares. */
export type DeskMessages = {
  bars: PageBars;
  /** Opens the one panel from any bar's item. */
  handle: ReturnType<typeof createHandle>;
  /** Messages' unread conversations, as the page that is drawn reads them. */
  unread: UnreadCount;
};

/** The item's shared state, once per desktop. */
export const deskMessages = perHost(
  (): DeskMessages => ({
    bars: pageBars(),
    handle: createHandle(),
    unread: unreadCount(),
  }),
);
