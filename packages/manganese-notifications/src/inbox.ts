/// <reference types="@domicile-desktop/manganese-host/domicile-elements" />

import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { Icon } from "@phosphor-icons/react";

export enum InboxReadingKind {
  SignedOut,
  Counted,
  Unread,
  Failed,
}

/** What the drawer knows of one inbox. Counts are conversations. */
export const InboxReading = {
  /** Every conversation, and the unread ones. */
  Counted: (total: number, unread: number) => ({
    kind: InboxReadingKind.Counted as const,
    total,
    unread,
  }),
  /** The read failed, for `reason`. */
  Failed: (reason: string) => ({
    kind: InboxReadingKind.Failed as const,
    reason,
  }),
  /** The inbox needs signing in, or its sign-in was revoked. */
  SignedOut: () => ({ kind: InboxReadingKind.SignedOut as const }),
  /** Only the unread conversations are known. */
  Unread: (unread: number) => ({
    kind: InboxReadingKind.Unread as const,
    unread,
  }),
};

export type InboxReading = ReturnType<
  (typeof InboxReading)[keyof typeof InboxReading]
>;

/** How many of `reading`'s conversations are unread; none if unknown. */
export const unreadIn = (reading: InboxReading | undefined): number => {
  switch (reading?.kind) {
    case InboxReadingKind.Counted:
    case InboxReadingKind.Unread:
      return reading.unread;
    case InboxReadingKind.SignedOut:
    case InboxReadingKind.Failed:
    case undefined:
      return 0;
  }
};

export enum InboxKind {
  Watched,
  Page,
}

/**
 * One inbox listed in the notification drawer. Its unread conversations count
 * toward the bell.
 */
export const Inbox = {
  /**
   * A page drawn in the drawer, widened, in place of the list. It stays
   * loaded while hidden, so its notifications keep coming.
   */
  Page: (inbox: {
    icon: Icon;
    /** Its name in the list, and the drawer's title while shown. */
    name: string;
    /** The page's address. */
    url: string;
    /**
     * Calls `onUnread` with the page's unread conversations, from the page
     * itself. Returns what stops it.
     */
    countUnread: (
      view: HTMLWebViewElement,
      onUnread: (unread: number) => void,
    ) => () => void;
  }) => ({ ...inbox, kind: InboxKind.Page as const }),
  /** Read from outside, and opened elsewhere, such as in a browser window. */
  Watched: (inbox: {
    icon: Icon;
    /** Its name in the list. */
    name: string;
    /** Its reading, watched while the shell runs. */
    read: (domicile: Domicile) => SharedWatch<InboxReading>;
    /** Opens it, or signs it in, for a press of its row. */
    open: (domicile: Domicile, reading: InboxReading | undefined) => void;
  }) => ({ ...inbox, kind: InboxKind.Watched as const }),
};

export type Inbox = ReturnType<(typeof Inbox)[keyof typeof Inbox]>;
