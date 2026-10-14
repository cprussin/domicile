import type { Option } from "@cprussin/option-result";
import { None, Some } from "@cprussin/option-result";
import type {
  DomicileFetchResponse,
  DomicileHost,
} from "@domicile-desktop/sdk/domicile-host";
import { z } from "zod";

import { inboxAddress } from "./addresses";

/** Where Google sends a browser that is not signed in. */
const SIGN_IN_HOST = "accounts.google.com";

/**
 * What Gmail's sync needs, read from the account's page. Undocumented: these
 * are the values Gmail's own page sends its sync.
 */
const sessionSchema = z.object({
  /** `var GLOBALS=[null,null,<g2>,"<build>",…`: the build Gmail serves. */
  build: z.string().min(1),
  /** The number after the build in `GLOBALS`, which the sync is sent. */
  g2: z
    .string()
    .regex(/^\d+$/)
    .transform((g2) => Number(g2)),
  /** `var GM_ID_KEY = '<key>'`. */
  idKey: z.string().min(1),
  /** The account's place among the signed-in ones: `/mail/u/<index>/`. */
  index: z
    .string()
    .regex(/^\d+$/)
    .transform((index) => Number(index)),
  /** The page's XSRF token, which the sync is sent as a header. */
  token: z.string().min(1),
});

export type Session = z.output<typeof sessionSchema>;

/**
 * Reads the account's Gmail page with the browser profile's sign-in, for what
 * its sync needs. `None` when the profile is not signed in to `email`: Gmail
 * sends the browser to sign in, or serves another signed-in account.
 *
 * Rejects when the page fails, or lacks a value the sync needs.
 */
export const readSession = async (
  domicile: Pick<DomicileHost, "fetchWithCookies">,
  email: string,
): Promise<Option<Session>> => {
  const response = await domicile.fetchWithCookies(
    inboxAddress(email),
    "GET",
    [],
    null,
    null,
  );
  if (new URL(response.url).hostname === SIGN_IN_HOST) {
    return None();
  } else if (response.status === 200) {
    return names(response.body, email) ? Some(parsePage(response)) : None();
  } else {
    throw new Error(`Gmail's page answered ${response.status.toString()}`);
  }
};

/**
 * Whether the page names `email` as a whole address, which it does for its own
 * account. `me@example.com` is not named by `some@example.com`.
 */
const names = (body: string, email: string): boolean =>
  new RegExp(
    `(^|[^\\w.+-])${email.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w.-])`,
    "i",
  ).test(body);

const parsePage = ({ body, url }: DomicileFetchResponse): Session => {
  const globals = /var GLOBALS=\[null,null,(\d+),"([^"]+)"/.exec(body);
  return sessionSchema.parse({
    build: globals?.[2],
    g2: globals?.[1],
    idKey: /var GM_ID_KEY\s*=\s*'([^']+)'/.exec(body)?.[1],
    index: /\/mail\/u\/(\d+)\//.exec(new URL(url).pathname)?.[1],
    token: /AKwhgQ[\w-]+:\d+/.exec(body)?.[0],
  });
};
