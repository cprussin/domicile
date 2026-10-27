import { inboxAddress } from "@domicile-desktop/manganese-bar-module-gmail/addresses";
import type { GoogleClient } from "@domicile-desktop/manganese-bar-module-gmail/consent";
import { deskInbox } from "@domicile-desktop/manganese-bar-module-gmail/desk-inbox";
import type { Inbox as GmailReading } from "@domicile-desktop/manganese-bar-module-gmail/inbox";
import { InboxKind as GmailKind } from "@domicile-desktop/manganese-bar-module-gmail/inbox";
import {
  Inbox,
  InboxReading,
  InboxReadingKind,
} from "@domicile-desktop/manganese-notifications/inbox";
import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";

type Options = {
  /** The Google Cloud OAuth client (Desktop app) it signs in with. */
  client: GoogleClient;
  /** The Google account, such as `me@gmail.com`. */
  email: string;
  /** The account's name in the drawer, such as `Work`. */
  nickname: string;
};

/**
 * One Gmail account's inbox in the notification drawer, read with the Gmail
 * API: its conversations, with the unread ones counted toward the bell. A
 * press opens it in a browser window, or signs it in. Goes in
 * `runManganese`'s `inboxes`.
 */
export const gmailInbox = ({ client, email, nickname }: Options): Inbox =>
  Inbox.Watched({
    icon: EnvelopeSimpleIcon,
    name: nickname,
    open: (domicile, reading) => {
      if (reading?.kind === InboxReadingKind.SignedOut) {
        deskInbox(domicile)(email, client).signIn();
      } else {
        domicile.browser.open(inboxAddress(email));
      }
    },
    read: perDesktop((domicile) =>
      asReadings(deskInbox(domicile)(email, client).inbox),
    ),
  });

/** `watch`'s readings, as the drawer reads them. */
const asReadings = (watch: SharedWatch<GmailReading>) =>
  sharedWatch<InboxReading>((onReading) =>
    watch.subscribe(() => {
      const reading = watch.current();
      if (reading !== undefined) {
        onReading(asReading(reading));
      }
    }),
  );

const asReading = (reading: GmailReading): InboxReading => {
  switch (reading.kind) {
    case GmailKind.SignedOut:
      return InboxReading.SignedOut();
    case GmailKind.Counted:
      return InboxReading.Counted(reading.total, reading.unread);
    case GmailKind.Failed:
      return InboxReading.Failed(reading.reason);
  }
};
