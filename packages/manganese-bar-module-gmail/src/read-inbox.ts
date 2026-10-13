import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type {
  DomicileFetchResponse,
  DomicileHost,
} from "@domicile-desktop/sdk/domicile-host";
import { z } from "zod";

import { feedAddress, GMAIL_ORIGIN } from "./addresses";
import { Inbox } from "./inbox";

/**
 * The INBOX label from the Gmail API, through `clients6.google.com`: Google's
 * first-party alias for `googleapis.com`, which gets the `google.com` cookies
 * a `googleapis.com` address does not.
 */
const LABEL_ADDRESS =
  "https://clients6.google.com/gmail/v1/users/me/labels/INBOX";

/** Where Google sends a browser that is not signed in. */
const SIGN_IN_HOST = "accounts.google.com";

/** The feed's title, which names the account, and its unread count. */
const feedSchema = z.object({
  fullcount: z
    .string()
    .regex(/^\d+$/)
    .transform((count) => Number(count)),
  title: z.string(),
});

type Feed = z.infer<typeof feedSchema>;

/**
 * The INBOX label's conversation counts. Conversations, not messages, because
 * Gmail's own inbox counts conversations.
 */
const labelSchema = z.object({
  threadsTotal: z.number().int().nonnegative(),
  threadsUnread: z.number().int().nonnegative(),
});

type Label = z.infer<typeof labelSchema>;

/**
 * Reads the account's inbox with the browser profile's Google sign-in.
 *
 * - The Atom feed says whether the profile is signed in to `email`, and how
 *   many conversations are unread.
 * - The Gmail API, with Google's first-party cookie authentication, adds the
 *   total. Undocumented; when it fails, the feed's count stands alone.
 *
 * Rejects when the feed fails, which says nothing of the sign-in. `warn`
 * hears why the API failed.
 */
export const readInbox = async (
  domicile: Pick<DomicileHost, "fetchWithCookies">,
  email: string,
  warn: (why: string) => void = warnUnreadOnly,
): Promise<Inbox> => {
  const response = await domicile.fetchWithCookies(
    feedAddress(email),
    [],
    null,
  );
  return accountFeed(response, email).match({
    None: () => Promise.resolve(Inbox.SignedOut()),
    Some: (feed) => countedOrUnread(domicile, email, feed, warn),
  });
};

/**
 * The account's feed, or `None` when the profile is not signed in to it.
 * Google answers 401 or sends the browser to sign in, or serves another
 * signed-in account's feed, whose title names that account.
 */
const accountFeed = (
  response: DomicileFetchResponse,
  email: string,
): Option<Feed> => {
  if (
    response.status === 401 ||
    response.status === 403 ||
    new URL(response.url).hostname === SIGN_IN_HOST
  ) {
    return None();
  } else if (response.status === 200) {
    const feed = parseFeed(response.body);
    return feed.title
      .split(/\s+/)
      .some((word) => word.toLowerCase() === email.toLowerCase())
      ? Some(feed)
      : None();
  } else {
    throw new Error(`the Gmail feed answered ${response.status.toString()}`);
  }
};

const parseFeed = (body: string): Feed =>
  feedSchema.parse({
    fullcount: /<fullcount>(\d+)<\/fullcount>/.exec(body)?.[1],
    title: /<title>([^<]*)<\/title>/.exec(body)?.[1],
  });

/** The API's counts, or the feed's unread count when the API fails. */
const countedOrUnread = async (
  domicile: Pick<DomicileHost, "fetchWithCookies">,
  email: string,
  feed: Feed,
  warn: (why: string) => void,
): Promise<Inbox> =>
  (await askLabel(domicile, email)).match({
    Err: (why): Inbox => {
      warn(why);
      return Inbox.Unread(feed.fullcount);
    },
    Ok: ({ threadsTotal, threadsUnread }): Inbox =>
      Inbox.Counted(threadsTotal, threadsUnread),
  });

/** Asks the Gmail API for the INBOX label as `email`. */
const askLabel = (
  domicile: Pick<DomicileHost, "fetchWithCookies">,
  email: string,
): Promise<Result<Label, string>> =>
  domicile
    .fetchWithCookies(
      LABEL_ADDRESS,
      [
        { name: "Origin", value: GMAIL_ORIGIN },
        { name: "X-Origin", value: GMAIL_ORIGIN },
        { name: "X-Goog-AuthUser", value: email },
      ],
      GMAIL_ORIGIN,
    )
    .then(parseLabel, (error: unknown) =>
      Err(`the browser could not ask: ${String(error)}`),
    );

const parseLabel = (label: DomicileFetchResponse): Result<Label, string> => {
  if (label.status === 200) {
    const parsed = z
      .string()
      .transform(jsonOf)
      .pipe(labelSchema)
      .safeParse(label.body);
    return parsed.success
      ? Ok(parsed.data)
      : Err(z.prettifyError(parsed.error));
  } else {
    return Err(`the Gmail API answered ${label.status.toString()}`);
  }
};

const jsonOf = (text: string, context: z.RefinementCtx): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    context.addIssue({ code: "custom", input: text, message: "not JSON" });
    return z.NEVER;
  }
};

const warnUnreadOnly = (why: string) => {
  // biome-ignore lint/suspicious/noConsole: the bar shows only the unread count, and this says why
  console.warn("manganese: the Gmail API failed; showing unread only", why);
};
