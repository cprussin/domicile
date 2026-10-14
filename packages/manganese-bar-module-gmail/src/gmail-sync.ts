import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type {
  DomicileFetchResponse,
  DomicileHost,
} from "@domicile-desktop/sdk/domicile-host";
import { z } from "zod";

import { GMAIL_ORIGIN } from "./addresses";
import type { Session } from "./gmail-session";

/**
 * What Gmail's page posts its sync to ask for the labels' counts. Gmail's own
 * protocol, undocumented; captured from Gmail's page.
 */
const SYNC_BODY =
  "[null,null,[3,null,null,null,[90,0],null,1],[null,0,null,0,0],1]";

/**
 * The fields of the `X-Gmail-BTAI` header, the browser-tab info, by index:
 * the fewest that still get the labels' counts. Gmail answers 500, or no
 * labels, without them.
 */
const btaiOf = (session: Session): readonly unknown[] => {
  const fields: Readonly<Record<number, unknown>> = {
    2: Array.from({ length: 138 }, (_, index) => (index === 12 ? 1 : null)),
    4: session.idKey,
    6: 31,
    7: session.build,
    8: 1,
    9: 5,
    10: "",
    15: session.g2,
  };
  return Array.from({ length: 21 }, (_, index) => fields[index] ?? null);
};

/** A label's row in the sync's answer: its id, then unread, then total. */
const inboxRowSchema = z.tuple(
  [
    z.literal("^i"),
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ],
  z.unknown(),
);

type Counts = { total: number; unread: number };

/**
 * Asks Gmail's sync for the inbox's conversation counts, as Gmail's own page
 * does. Fails when the session is stale, which reading the page again fixes.
 */
export const syncInbox = (
  domicile: Pick<DomicileHost, "fetchWithCookies">,
  session: Session,
): Promise<Result<Counts, string>> =>
  domicile
    .fetchWithCookies(
      `${GMAIL_ORIGIN}/sync/u/${session.index.toString()}/i/s?hl=en&c=0&rt=r&pt=ji`,
      "POST",
      [
        { name: "Content-Type", value: "application/json" },
        { name: "X-Google-BTD", value: "1" },
        { name: "X-Framework-Xsrf-Token", value: session.token },
        { name: "X-Gmail-BTAI", value: JSON.stringify(btaiOf(session)) },
      ],
      SYNC_BODY,
      null,
    )
    .then(countsOf, (error: unknown) =>
      Err(`the browser could not sync: ${String(error)}`),
    );

const countsOf = (synced: DomicileFetchResponse): Result<Counts, string> => {
  if (synced.status === 200) {
    const parsed = z.string().transform(jsonOf).safeParse(synced.body);
    return parsed.success
      ? inboxRow(parsed.data).match({
          None: () => Err(`Gmail's sync has no inbox: ${synced.body}`),
          Some: ([, unread, total]) => Ok({ total, unread }),
        })
      : Err(z.prettifyError(parsed.error));
  } else {
    return Err(`Gmail's sync answered ${synced.status.toString()}`);
  }
};

/**
 * The inbox's row, wherever the answer nests it. An error answer,
 * `["er",…]`, has none.
 */
const inboxRow = (value: unknown): Option<z.output<typeof inboxRowSchema>> => {
  const row = inboxRowSchema.safeParse(value);
  if (row.success) {
    return Some(row.data);
  } else if (Array.isArray(value)) {
    return value.reduce<Option<z.output<typeof inboxRowSchema>>>(
      (found, item) => (found.isSome() ? found : inboxRow(item)),
      None(),
    );
  } else {
    return None();
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
