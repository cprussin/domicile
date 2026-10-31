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
  Window,
}

/** What every inbox has. */
type Named = {
  icon: Icon;
  /** Its name in the list. */
  name: string;
  /**
   * Its name in the launcher, which lists it as an app. `name` when not
   * given.
   */
  launcherName?: string;
  /**
   * The sender its new conversations are notified under, such as a site's
   * origin. Those notifications stay out of the bell's count, which already
   * holds the inbox's unread conversations.
   */
  notifiesAs: string;
};

/**
 * One inbox listed in the notification drawer and the launcher. Its unread
 * conversations count toward the bell.
 */
export const Inbox = {
  /**
   * Read from outside, and opened elsewhere, such as in an app window of its
   * own.
   */
  Watched: (
    inbox: Named & {
      /** Its reading, watched while the shell runs. */
      read: (domicile: Domicile) => SharedWatch<InboxReading>;
      /** Opens it, or signs it in, for a press of its row. */
      open: (domicile: Domicile, reading: InboxReading | undefined) => void;
      /**
       * The app window it opens in, if any, which the launcher lists: app
       * `appId`'s, at `url`.
       */
      app?: { appId: string; url: string };
    },
  ) => ({ ...inbox, kind: InboxKind.Watched as const }),
  /**
   * A page in an app window of its own, which runs in the background: it opens
   * hidden when the shell starts, shows when its row is pressed or its page
   * asks to be in front, and hides when closed. So its notifications keep
   * coming and its count stays current.
   */
  Window: (
    inbox: Named & {
      /** The app id of its window. One window per id. */
      appId: string;
      /** The page's address. */
      url: string;
      /**
       * Calls `onUnread` with the page's unread conversations, read with
       * `countMatches`, which counts the window's elements matching a CSS
       * selector. Returns what stops it.
       */
      countUnread: (
        countMatches: (selector: string) => Promise<number>,
        onUnread: (unread: number) => void,
      ) => () => void;
    },
  ) => ({ ...inbox, kind: InboxKind.Window as const }),
};

export type Inbox = ReturnType<(typeof Inbox)[keyof typeof Inbox]>;
