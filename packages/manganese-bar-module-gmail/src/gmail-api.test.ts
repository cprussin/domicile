import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { inboxCounts, mailHeaders, unreadMail } from "./gmail-api";
import { answering, HEADERS, INBOX, json, UNREAD } from "./held-google";

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

describe("unreadMail", () => {
  it("lists the inbox's unread messages, newest first", async () => {
    const { domicile } = answering({
      [UNREAD]: [
        json(200, {
          messages: [
            { id: "m2", threadId: "t1" },
            { id: "m1", threadId: "t1" },
          ],
          resultSizeEstimate: 2,
        }),
      ],
    });

    expect(await unreadMail(domicile, "acc3ss")).toStrictEqual(
      Ok(["m2", "m1"]),
    );
  });

  it("lists none when Gmail leaves the list out", async () => {
    const { domicile } = answering({
      [UNREAD]: [json(200, { resultSizeEstimate: 0 })],
    });

    expect(await unreadMail(domicile, "acc3ss")).toStrictEqual(Ok([]));
  });
});

describe("mailHeaders", () => {
  it("reads a message's sender and subject", async () => {
    const { domicile, fetched } = answering({
      [HEADERS("m1")]: [
        json(200, {
          id: "m1",
          payload: {
            headers: [
              { name: "Subject", value: "Dinner Friday?" },
              { name: "From", value: '"Alex Chen" <alex@example.com>' },
            ],
          },
          threadId: "t1",
        }),
      ],
    });

    expect(await mailHeaders(domicile, "acc3ss", "m1")).toStrictEqual(
      Ok({
        from: "Alex Chen",
        id: "m1",
        subject: "Dinner Friday?",
        threadId: "t1",
      }),
    );
    expect(fetched[0]?.headers).toStrictEqual([
      { name: "Authorization", value: "Bearer acc3ss" },
    ]);
  });

  it.each([
    ["alex@example.com", "alex@example.com"],
    ['"" <alex@example.com>', "alex@example.com"],
  ])(
    "names a sender who gives no name, %p, by their address",
    async (from, named) => {
      const { domicile } = answering({
        [HEADERS("m1")]: [
          json(200, {
            id: "m1",
            payload: { headers: [{ name: "From", value: from }] },
            threadId: "t1",
          }),
        ],
      });

      expect(await mailHeaders(domicile, "acc3ss", "m1")).toStrictEqual(
        Ok({ from: named, id: "m1", subject: "(no subject)", threadId: "t1" }),
      );
    },
  );

  it("names a message with no sender as unknown", async () => {
    const { domicile } = answering({
      [HEADERS("m1")]: [
        json(200, {
          id: "m1",
          payload: { headers: [{ name: "Subject", value: "Hi" }] },
          threadId: "t1",
        }),
      ],
    });

    expect(await mailHeaders(domicile, "acc3ss", "m1")).toStrictEqual(
      Ok({ from: "Unknown sender", id: "m1", subject: "Hi", threadId: "t1" }),
    );
  });
});
