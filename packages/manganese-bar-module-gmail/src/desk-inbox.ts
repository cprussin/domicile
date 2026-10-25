import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";

import type { GoogleClient } from "./consent";
import { watchGmailWindows } from "./gmail-windows";
import type { Inbox } from "./inbox";
import { inboxReader } from "./read-inbox";
import { signIn } from "./sign-in";
import type { InboxWatch } from "./watch-inbox";
import { watchInbox } from "./watch-inbox";

/** One account on the desk. */
export type DeskAccount = {
  /** Its inbox, watched while any bar shows it. */
  inbox: SharedWatch<Inbox>;
  /**
   * Signs it in, then reads the inbox. A failed sign-in is a failed read.
   * Only while a bar shows it.
   */
  signIn: () => void;
};

/**
 * Each account's inbox, watched once for every bar on the desk. Read again
 * soon after a Gmail window changes. Paused while the desk is locked, which
 * refuses the reads.
 */
export const deskInbox = perHost((domicile) => {
  const accounts = new Map<string, DeskAccount>();
  return (email: string, client: GoogleClient): DeskAccount => {
    const known = accounts.get(email);
    if (known === undefined) {
      const account = watchedAccount(domicile, email, client);
      accounts.set(email, account);
      return account;
    } else {
      return known;
    }
  };
});

const watchedAccount = (
  domicile: Domicile,
  email: string,
  client: GoogleClient,
): DeskAccount => {
  const read = inboxReader(domicile, client, email);
  const running: { watch: InboxWatch | undefined } = { watch: undefined };
  return {
    inbox: sharedWatch((onInbox: (inbox: Inbox) => void) => {
      const watch = watchInbox(
        read,
        onInbox,
        () => domicile.session.locked === true,
      );
      const stopGmail = watchGmailWindows(domicile, watch.readSoon);
      running.watch = watch;
      return () => {
        stopGmail();
        watch.stop();
        running.watch = undefined;
      };
    }),
    signIn: () => {
      if (running.watch === undefined) {
        throw new Error(`no bar shows ${email} to sign in from`);
      } else {
        running.watch.answer(
          signIn(domicile, client, email).then(() => read()),
        );
      }
    },
  };
};
