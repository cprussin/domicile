import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { z } from "zod";

import { jsonText } from "./json-text";

/** The Gmail API's inbox label, which carries its counts. */
const INBOX = "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX";

/** The inbox's conversations: every one, and the unread ones. */
export type Counts = { total: number; unread: number };

/** Asks the Gmail API for the inbox's conversation counts. */
export const inboxCounts = (
  domicile: Pick<DomicileHost, "fetchWithCookies">,
  accessToken: string,
): Promise<Result<Counts, string>> =>
  domicile
    .fetchWithCookies(
      INBOX,
      "GET",
      [{ name: "Authorization", value: `Bearer ${accessToken}` }],
      null,
      null,
    )
    .then(
      (answer): Result<Counts, string> => {
        if (answer.status === 200) {
          const label = labelSchema.safeParse(answer.body);
          return label.success
            ? Ok(label.data)
            : Err(z.prettifyError(label.error));
        } else {
          return Err(
            `Gmail answered ${answer.status.toString()}: ${answer.body}`,
          );
        }
      },
      (error: unknown) =>
        Err(`the browser could not ask Gmail: ${String(error)}`),
    );

const labelSchema = jsonText.pipe(
  z
    .object({
      threadsTotal: z.number().int().nonnegative(),
      threadsUnread: z.number().int().nonnegative(),
    })
    .transform((label) => ({
      total: label.threadsTotal,
      unread: label.threadsUnread,
    })),
);
