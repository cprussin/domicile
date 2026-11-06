import {
  GMAIL_ORIGIN,
  gmailAppId,
  inboxAddress,
} from "@domicile-desktop/manganese-bar-module-gmail/addresses";
import type { GoogleClient } from "@domicile-desktop/manganese-bar-module-gmail/consent";
import { deskInbox } from "@domicile-desktop/manganese-bar-module-gmail/desk-inbox";
import type { Inbox as GmailReading } from "@domicile-desktop/manganese-bar-module-gmail/inbox";
import type { InboxReading } from "@domicile-desktop/manganese-notifications/inbox";
import {
  Inbox,
  InboxReadingKind,
} from "@domicile-desktop/manganese-notifications/inbox";
import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { AppReuse } from "@domicile-desktop/sdk/desktop/browser";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";

import { asReading } from "./as-reading";

type Options = {
  /** The Google Cloud OAuth client (Desktop app) it signs in with. */
  client: GoogleClient;
  /** The Google account, such as `me@gmail.com`. */
  email: string;
  /** The account's name in the drawer, such as `Work`. */
  nickname: string;
  /** Its name in the launcher, such as `Email - Work`. `nickname` if not given. */
  launcherName?: string;
};

/**
 * One Gmail account's inbox in the notification drawer and the launcher,
 * read with the Gmail API: its conversations, with the unread ones counted
 * toward the bell. A press opens it in the account's own Gmail window, or
 * brings that window up, or signs it in. Goes in `runManganese`'s `inboxes`.
 */
export const gmailInbox = ({
  client,
  email,
  launcherName,
  nickname,
}: Options): Inbox =>
  Inbox.Watched({
    account: email,
    app: { appId: gmailAppId(email), url: inboxAddress(email) },
    icon: EnvelopeSimpleIcon,
    ...(launcherName === undefined ? {} : { launcherName }),
    name: nickname,
    notifiesAs: nickname,
    open: (domicile, reading) => {
      if (reading?.kind === InboxReadingKind.SignedOut) {
        deskInbox(domicile)(email, client, nickname).signIn();
      } else {
        domicile.browser.openApp(inboxAddress(email), {
          id: gmailAppId(email),
          reuse: AppReuse.Focus,
        });
      }
    },
    read: perDesktop((domicile) =>
      asReadings(deskInbox(domicile)(email, client, nickname).inbox),
    ),
    // Gmail's page notifies the same mail while its window is open.
    replaces: new URL(GMAIL_ORIGIN).host,
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
