// Test doubles for Gmail: its page, its sync answer, and a desktop whose
// fetches answer from a table.

import type {
  DomicileFetchHeader,
  DomicileFetchResponse,
} from "@domicile-desktop/sdk/domicile-host";

import type { Session } from "./gmail-session";

export const EMAIL = "me@example.com";

export const PAGE = "https://mail.google.com/mail/?authuser=me%40example.com";

export const SYNC = "https://mail.google.com/sync/u/2/i/s?hl=en&c=0&rt=r&pt=ji";

/** What {@link page} holds, as the session reads it. */
export const SESSION: Session = {
  build: "gmail.pinto-server_20261008.15_p0",
  g2: 996_093_519,
  idKey: "k3y",
  index: 2,
  token: "AKwhgQr-9_x:1760400000000",
};

/** Gmail's page for `account`, cut to what the session reads. */
export const page = (account = EMAIL): string =>
  `<html><head><script>var GM_ID_KEY = 'k3y';var GLOBALS=[null,null,996093519,"gmail.pinto-server_20261008.15_p0","en"];</script></head><body data-token="AKwhgQr-9_x:1760400000000"><div aria-label="Google Account: Me (${account})"></div></body></html>`;

/** Gmail's sync answer with the inbox at `unread` of `total`. */
export const synced = (unread: number, total: number): string =>
  JSON.stringify([
    "s",
    null,
    [
      [
        ["^all", 1, 40],
        ["^i", unread, total],
      ],
    ],
  ]);

export const response = (
  status: number,
  body: string,
  url: string,
): DomicileFetchResponse => ({ body, status, url });

type Fetched = {
  url: string;
  method: string;
  headers: readonly DomicileFetchHeader[];
  body: string | null;
};

type Answer = DomicileFetchResponse | Error;

/**
 * A desktop whose fetches answer from `answers` by address, each address's
 * answers in turn and the last again, rejecting for an `Error`. Records what
 * was asked.
 */
export const answering = (
  answers: Readonly<Record<string, readonly Answer[]>>,
) => {
  const fetched: Fetched[] = [];
  return {
    domicile: {
      fetchWithCookies: (
        url: string,
        method: string,
        headers: readonly DomicileFetchHeader[],
        body: string | null,
      ): Promise<DomicileFetchResponse> => {
        const asked = fetched.filter((one) => one.url === url).length;
        fetched.push({ body, headers, method, url });
        const all = answers[url] ?? [];
        const answer = all[Math.min(asked, all.length - 1)];
        if (answer === undefined) {
          throw new Error(`test: nothing answers ${url}`);
        } else {
          return answer instanceof Error
            ? Promise.reject(answer)
            : Promise.resolve(answer);
        }
      },
    },
    fetched,
  };
};
