import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { syncInbox } from "./gmail-sync";
import { answering, response, SESSION, SYNC, synced } from "./held-gmail";

/** The header `name` the sync was sent with. */
const headerOf = (
  fetched: ReturnType<typeof answering>["fetched"],
  name: string,
): string | undefined =>
  fetched[0]?.headers.find((header) => header.name === name)?.value;

describe("syncInbox", () => {
  it("posts Gmail's sync for the account, as Gmail's own page does", async () => {
    const { domicile, fetched } = answering({
      [SYNC]: [response(200, synced(2, 4), SYNC)],
    });

    await syncInbox(domicile, SESSION);

    expect(fetched).toMatchObject([
      {
        body: "[null,null,[3,null,null,null,[90,0],null,1],[null,0,null,0,0],1]",
        method: "POST",
        url: SYNC,
      },
    ]);
    expect(headerOf(fetched, "Content-Type")).toBe("application/json");
    expect(headerOf(fetched, "X-Google-BTD")).toBe("1");
    expect(headerOf(fetched, "X-Framework-Xsrf-Token")).toBe(SESSION.token);
    // The engine sends Gmail's origin itself.
    expect(headerOf(fetched, "Origin")).toBeUndefined();
  });

  it("sends the smallest browser-tab info the sync answers", async () => {
    const { domicile, fetched } = answering({
      [SYNC]: [response(200, synced(2, 4), SYNC)],
    });

    await syncInbox(domicile, SESSION);

    const flags = Array.from({ length: 138 }, (_, index) =>
      index === 12 ? 1 : null,
    );
    expect(JSON.parse(headerOf(fetched, "X-Gmail-BTAI") ?? "")).toStrictEqual([
      null,
      null,
      flags,
      null,
      SESSION.idKey,
      null,
      31,
      SESSION.build,
      1,
      5,
      "",
      null,
      null,
      null,
      null,
      SESSION.g2,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("reads the inbox's unread and total conversations", async () => {
    const { domicile } = answering({
      [SYNC]: [response(200, synced(2, 4), SYNC)],
    });

    expect(await syncInbox(domicile, SESSION)).toStrictEqual(
      Ok({ total: 4, unread: 2 }),
    );
  });

  describe("fails", () => {
    it("when Gmail answers with an error", async () => {
      const { domicile } = answering({
        [SYNC]: [response(200, JSON.stringify(["er", null, null, 500]), SYNC)],
      });

      expect((await syncInbox(domicile, SESSION)).isErr()).toBe(true);
    });

    it("when the answer has no inbox", async () => {
      const { domicile } = answering({
        [SYNC]: [response(200, JSON.stringify(["s", null, [[]]]), SYNC)],
      });

      expect((await syncInbox(domicile, SESSION)).isErr()).toBe(true);
    });

    it("when the status is not OK", async () => {
      const { domicile } = answering({
        [SYNC]: [response(403, "Forbidden", SYNC)],
      });

      expect(await syncInbox(domicile, SESSION)).toStrictEqual(
        Err("Gmail's sync answered 403"),
      );
    });

    it("when the browser could not send it", async () => {
      const { domicile } = answering({
        [SYNC]: [new Error("the desk is locked")],
      });

      expect((await syncInbox(domicile, SESSION)).isErr()).toBe(true);
    });
  });
});
