import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

import type { Session } from "./gmail-session";
import { readSession } from "./gmail-session";
import { syncInbox } from "./gmail-sync";
import { Inbox } from "./inbox";

/** How long a page's session is used before the page is read again. */
const SESSION_MS = 60 * 60 * 1000;

type Held = { session: Session; readAt: number };

/**
 * Reads the account's inbox with the browser profile's Google sign-in, each
 * call one read. Undocumented: Gmail's own page and sync.
 *
 * - The page says whether the profile is signed in to `email`, and holds what
 *   the sync needs. It is read once, and again after an hour or when a sync
 *   fails, which a stale token does.
 * - The sync answers the inbox's conversation counts.
 *
 * A read rejects when the page fails, or when the sync fails on a page just
 * read.
 */
export const inboxReader = (
  domicile: Pick<DomicileHost, "fetchWithCookies">,
  email: string,
  now: () => number = Date.now,
): (() => Promise<Inbox>) => {
  const held: { current: Held | undefined } = { current: undefined };

  const readFresh = async (): Promise<Inbox> =>
    (await readSession(domicile, email)).match({
      None: () => {
        held.current = undefined;
        return Promise.resolve(Inbox.SignedOut());
      },
      Some: async (session) => {
        held.current = { readAt: now(), session };
        return (await syncInbox(domicile, session)).match({
          Err: (why): Inbox => {
            held.current = undefined;
            throw new Error(why);
          },
          Ok: ({ total, unread }): Inbox => Inbox.Counted(total, unread),
        });
      },
    });

  return async () => {
    const known = held.current;
    if (known === undefined || now() - known.readAt >= SESSION_MS) {
      return readFresh();
    } else {
      return (await syncInbox(domicile, known.session)).match({
        Err: () => readFresh(),
        Ok: ({ total, unread }) =>
          Promise.resolve(Inbox.Counted(total, unread)),
      });
    }
  };
};
