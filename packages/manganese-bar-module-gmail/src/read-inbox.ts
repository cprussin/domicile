import { Result } from "@cprussin/option-result";

import type { GoogleClient } from "./consent";
import type { Counts, Mail } from "./gmail-api";
import { inboxCounts, mailHeaders, unreadMail } from "./gmail-api";
import type { Fetch, TokenRefusal } from "./google-token";
import { refreshAccess, TokenRefusalKind } from "./google-token";
import { Inbox } from "./inbox";
import { forgetToken, storedToken } from "./stored-token";

type Held = { token: string; expiresAt: number };

/**
 * Reads the account's inbox through the Gmail API, each call one read.
 *
 * - Before the account signs in, or once Google revokes its refresh token
 *   (which is then forgotten), it is signed out.
 * - The refresh token gets an access token, kept until it expires or Gmail
 *   refuses it.
 * - Each read passes `onMail` the unread messages that arrived since the
 *   last, newest first, and waits for it. The first read after signing in
 *   passes none, so mail already there is not news.
 *
 * A read rejects when Google gives no access token, or Gmail no counts or
 * messages.
 */
export const inboxReader = (
  domicile: Fetch,
  client: GoogleClient,
  email: string,
  onMail: (mail: readonly Mail[]) => Promise<void>,
  storage?: Parameters<typeof storedToken>[1],
  now: () => number = Date.now,
): (() => Promise<Inbox>) => {
  const held: { current: Held | undefined } = { current: undefined };
  // Every unread message seen since signing in; `undefined` before the first
  // read.
  const seen: { ids: ReadonlySet<string> | undefined } = { ids: undefined };

  const count = async (access: Held): Promise<Inbox> =>
    (await readMail(domicile, access.token, seen.ids)).match({
      Err: (why): Promise<Inbox> => {
        held.current = undefined;
        throw new Error(why);
      },
      Ok: async ({ counts, ids, mail }) => {
        seen.ids = new Set([...(seen.ids ?? []), ...ids]);
        if (mail.length > 0) {
          await onMail(mail);
        }
        return Inbox.Counted(counts.total, counts.unread);
      },
    });

  const signedOut = (): Inbox => {
    seen.ids = undefined;
    return Inbox.SignedOut();
  };

  const refused = (refusal: TokenRefusal): Inbox => {
    switch (refusal.kind) {
      case TokenRefusalKind.Revoked: {
        forgetToken(email, storage);
        return signedOut();
      }
      case TokenRefusalKind.Failed: {
        throw new Error(refusal.reason);
      }
    }
  };

  const refreshed = async (refreshToken: string): Promise<Inbox> => {
    const askedAt = now();
    return (await refreshAccess(domicile, client, refreshToken)).match({
      Err: (refusal) => Promise.resolve(refused(refusal)),
      Ok: (access) => {
        held.current = {
          expiresAt: askedAt + access.expiresInMs,
          token: access.token,
        };
        return count(held.current);
      },
    });
  };

  return () =>
    storedToken(email, storage).match({
      None: () => Promise.resolve(signedOut()),
      Some: (refreshToken) => {
        const access = held.current;
        return access === undefined || now() >= access.expiresAt
          ? refreshed(refreshToken)
          : count(access);
      },
    });
};

/**
 * The inbox's counts and unread messages, and the headers of those not in
 * `seen`; none when nothing was seen yet.
 */
const readMail = async (
  domicile: Fetch,
  token: string,
  seen: ReadonlySet<string> | undefined,
): Promise<Result<{ counts: Counts; ids: string[]; mail: Mail[] }, string>> => {
  const [counts, unread] = await Promise.all([
    inboxCounts(domicile, token),
    unreadMail(domicile, token),
  ]);
  return counts
    .andThen((counted) => unread.map((ids) => ({ counts: counted, ids })))
    .andThenAsync(async ({ counts: counted, ids }) => {
      const fresh = seen === undefined ? [] : ids.filter((id) => !seen.has(id));
      const mail = Result.collect(
        await Promise.all(fresh.map((id) => mailHeaders(domicile, token, id))),
      );
      return mail.map((arrived) => ({ counts: counted, ids, mail: arrived }));
    });
};
