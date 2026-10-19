import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { inboxCounts } from "./gmail-api";
import { answering, INBOX, json } from "./held-google";

describe("inboxCounts", () => {
  it("counts the inbox's conversations, with the access token", async () => {
    const { domicile, fetched } = answering({
      [INBOX]: [
        json(200, {
          id: "INBOX",
          messagesTotal: 9,
          messagesUnread: 3,
          threadsTotal: 4,
          threadsUnread: 2,
        }),
      ],
    });

    expect(await inboxCounts(domicile, "acc3ss")).toStrictEqual(
      Ok({ total: 4, unread: 2 }),
    );
    expect(fetched).toStrictEqual([
      {
        body: null,
        headers: [{ name: "Authorization", value: "Bearer acc3ss" }],
        method: "GET",
        url: INBOX,
      },
    ]);
  });

  it("fails with Gmail's answer when it refuses", async () => {
    const { domicile } = answering({
      [INBOX]: [json(401, { error: { code: 401 } })],
    });

    expect(await inboxCounts(domicile, "acc3ss")).toStrictEqual(
      Err('Gmail answered 401: {"error":{"code":401}}'),
    );
  });

  it("fails when the browser cannot ask", async () => {
    const { domicile } = answering({ [INBOX]: [new Error("offline")] });

    expect(await inboxCounts(domicile, "acc3ss")).toStrictEqual(
      Err("the browser could not ask Gmail: Error: offline"),
    );
  });
});
