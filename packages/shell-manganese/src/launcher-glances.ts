import type { AppGlance } from "@domicile-desktop/manganese-launcher/app-glance";
import { webAppId } from "@domicile-desktop/manganese-launcher/app-search";
import { ago } from "@domicile-desktop/manganese-notifications/ago";
import type {
  Inbox,
  InboxReading,
} from "@domicile-desktop/manganese-notifications/inbox";
import {
  InboxKind,
  InboxReadingKind,
} from "@domicile-desktop/manganese-notifications/inbox";

/**
 * What the launcher's preview tells of each inbox it lists, by row id: its
 * account, its unread count and its newest unread messages. `readings` and
 * `inboxes` go by place; `now` is epoch milliseconds.
 */
export const launcherGlancesOf = (
  inboxes: readonly Inbox[],
  readings: readonly (InboxReading | undefined)[],
  now: number,
): ReadonlyMap<string, AppGlance> =>
  new Map(
    inboxes.flatMap((inbox, index) => {
      const appId = launcherAppIdOf(inbox);
      const reading = readings[index];
      return appId === undefined
        ? []
        : [
            [
              webAppId({ appId }),
              {
                account: inbox.account,
                items:
                  reading?.kind === InboxReadingKind.Counted
                    ? reading.latest.map(({ from, receivedAt, subject }) => ({
                        at: ago(receivedAt, now),
                        text: subject,
                        title: from,
                      }))
                    : [],
                status: statusOf(reading),
              },
            ] as const,
          ];
    }),
  );

/** The app id `inbox` is listed in the launcher under, if it is. */
const launcherAppIdOf = (inbox: Inbox): string | undefined => {
  switch (inbox.kind) {
    case InboxKind.Watched: {
      return inbox.app?.appId;
    }
    case InboxKind.Window: {
      return inbox.appId;
    }
  }
};

/** `reading` in a few words; `undefined` before the first. */
const statusOf = (reading: InboxReading | undefined): string | undefined => {
  switch (reading?.kind) {
    case InboxReadingKind.Counted:
    case InboxReadingKind.Unread: {
      return reading.unread === 0
        ? "Nothing unread"
        : `${reading.unread.toString()} unread`;
    }
    case InboxReadingKind.SignedOut: {
      return "Not signed in";
    }
    case InboxReadingKind.Failed: {
      return "Couldn't check for new messages";
    }
    case undefined: {
      return undefined;
    }
  }
};
