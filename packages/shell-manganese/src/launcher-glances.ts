import type {
  AppGlance,
  GlanceStatus,
} from "@domicile-desktop/manganese-launcher/app-glance";
import { GlanceTone } from "@domicile-desktop/manganese-launcher/app-glance";
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
const statusOf = (
  reading: InboxReading | undefined,
): GlanceStatus | undefined => {
  switch (reading?.kind) {
    case InboxReadingKind.Counted:
    case InboxReadingKind.Unread: {
      return reading.unread === 0
        ? { text: "No unread messages", tone: GlanceTone.Clear }
        : {
            text: `${reading.unread.toString()} unread`,
            tone: GlanceTone.Waiting,
          };
    }
    case InboxReadingKind.SignedOut: {
      return { text: "Not signed in", tone: GlanceTone.Note };
    }
    case InboxReadingKind.Failed: {
      return { text: "Couldn't check for new messages", tone: GlanceTone.Note };
    }
    case undefined: {
      return undefined;
    }
  }
};
