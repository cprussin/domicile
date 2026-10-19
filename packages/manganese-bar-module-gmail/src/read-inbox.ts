import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

import type { GoogleClient } from "./consent";
import { inboxCounts } from "./gmail-api";
import type { TokenRefusal } from "./google-token";
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
 *
 * A read rejects when Google gives no access token, or Gmail no counts.
 */
export const inboxReader = (
  domicile: Pick<DomicileHost, "fetchWithCookies">,
  client: GoogleClient,
  email: string,
  storage?: Parameters<typeof storedToken>[1],
  now: () => number = Date.now,
): (() => Promise<Inbox>) => {
  const held: { current: Held | undefined } = { current: undefined };

  const count = async (access: Held): Promise<Inbox> =>
    (await inboxCounts(domicile, access.token)).match({
      Err: (why): Inbox => {
        held.current = undefined;
        throw new Error(why);
      },
      Ok: ({ total, unread }) => Inbox.Counted(total, unread),
    });

  const refused = (refusal: TokenRefusal): Inbox => {
    switch (refusal.kind) {
      case TokenRefusalKind.Revoked: {
        forgetToken(email, storage);
        return Inbox.SignedOut();
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
      None: () => Promise.resolve(Inbox.SignedOut()),
      Some: (refreshToken) => {
        const access = held.current;
        return access === undefined || now() >= access.expiresAt
          ? refreshed(refreshToken)
          : count(access);
      },
    });
};
