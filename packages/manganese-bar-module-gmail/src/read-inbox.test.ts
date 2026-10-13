import { describe, expect, it } from "bun:test";
import type {
  DomicileFetchHeader,
  DomicileFetchResponse,
} from "@domicile-desktop/sdk/domicile-host";

import { Inbox } from "./inbox";
import { readInbox } from "./read-inbox";

const EMAIL = "me@example.com";
const FEED = "https://mail.google.com/mail/u/me@example.com/feed/atom";
const LABEL = "https://clients6.google.com/gmail/v1/users/me/labels/INBOX";

/** A feed as Gmail serves it, with `unread` unread conversations. */
const feed = (unread: number, account = EMAIL) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed version="0.3" xmlns="http://purl.org/atom/ns#"><title>Gmail - Inbox for ${account}</title><tagline>New messages in your Gmail Inbox</tagline><fullcount>${unread.toString()}</fullcount><link rel="alternate" href="https://mail.google.com/mail/u/0" type="text/html" /><entry><title>Lunch</title></entry></feed>`;

const response = (
  status: number,
  body: string,
  url: string,
): DomicileFetchResponse => ({ body, status, url });

type Fetched = {
  url: string;
  headers: readonly DomicileFetchHeader[];
  sapisidHashOrigin: string | null;
};

/**
 * A desktop whose fetches answer from `answers` by address, rejecting for an
 * `Error`, and which records what was asked.
 */
const answering = (
  answers: Readonly<Record<string, DomicileFetchResponse | Error>>,
) => {
  const fetched: Fetched[] = [];
  return {
    domicile: {
      fetchWithCookies: (
        url: string,
        headers: readonly DomicileFetchHeader[],
        sapisidHashOrigin: string | null,
      ): Promise<DomicileFetchResponse> => {
        fetched.push({ headers, sapisidHashOrigin, url });
        const answer = answers[url];
        if (answer === undefined) {
          throw new Error(`nothing answers ${url}`);
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

/** For a read that has nothing to warn of. */
const neverWarns = (why: string) => {
  throw new Error(`test: the read warned: ${why}`);
};

/** Reads the inbox, collecting what it warns of. */
const readWarning = async (
  domicile: ReturnType<typeof answering>["domicile"],
) => {
  const warnings: string[] = [];
  const inbox = await readInbox(domicile, EMAIL, (why) => {
    warnings.push(why);
  });
  return { inbox, warnings };
};

describe("readInbox", () => {
  describe("signed out", () => {
    it("is signed out when the feed refuses", async () => {
      const { domicile } = answering({
        [FEED]: response(401, "Unauthorized", FEED),
      });

      expect(await readInbox(domicile, EMAIL, neverWarns)).toStrictEqual(
        Inbox.SignedOut(),
      );
    });

    it("is signed out when the feed sends the browser to sign in", async () => {
      const { domicile } = answering({
        [FEED]: response(
          200,
          "<html></html>",
          "https://accounts.google.com/ServiceLogin?service=mail",
        ),
      });

      expect(await readInbox(domicile, EMAIL, neverWarns)).toStrictEqual(
        Inbox.SignedOut(),
      );
    });

    it("is signed out when the feed is another account's", async () => {
      const { domicile } = answering({
        [FEED]: response(200, feed(3, "some@example.com"), FEED),
      });

      expect(await readInbox(domicile, EMAIL, neverWarns)).toStrictEqual(
        Inbox.SignedOut(),
      );
    });
  });

  it("counts conversations with the Gmail API as the signed-in account", async () => {
    const { domicile, fetched } = answering({
      [FEED]: response(200, feed(3), FEED),
      [LABEL]: response(
        200,
        JSON.stringify({
          id: "INBOX",
          messagesTotal: 40,
          messagesUnread: 5,
          threadsTotal: 31,
          threadsUnread: 3,
        }),
        LABEL,
      ),
    });

    expect(await readInbox(domicile, EMAIL, neverWarns)).toStrictEqual(
      Inbox.Counted(31, 3),
    );
    expect(fetched).toStrictEqual([
      { headers: [], sapisidHashOrigin: null, url: FEED },
      {
        headers: [
          { name: "Origin", value: "https://mail.google.com" },
          { name: "X-Origin", value: "https://mail.google.com" },
          { name: "X-Goog-AuthUser", value: EMAIL },
        ],
        sapisidHashOrigin: "https://mail.google.com",
        url: LABEL,
      },
    ]);
  });

  describe("falls back to the feed's unread count", () => {
    it("when the Gmail API refuses", async () => {
      const { domicile } = answering({
        [FEED]: response(200, feed(3), FEED),
        [LABEL]: response(401, "{}", LABEL),
      });

      expect(await readWarning(domicile)).toMatchObject({
        inbox: Inbox.Unread(3),
        warnings: [expect.anything()],
      });
    });

    it("when the browser cannot ask the Gmail API", async () => {
      const { domicile } = answering({
        [FEED]: response(200, feed(3), FEED),
        [LABEL]: new Error("no SAPISID cookie is sent to clients6.google.com"),
      });

      expect(await readWarning(domicile)).toMatchObject({
        inbox: Inbox.Unread(3),
        warnings: [expect.anything()],
      });
    });

    it("when the Gmail API's answer is not a label", async () => {
      const { domicile } = answering({
        [FEED]: response(200, feed(3), FEED),
        [LABEL]: response(200, "<html></html>", LABEL),
      });

      expect(await readWarning(domicile)).toMatchObject({
        inbox: Inbox.Unread(3),
        warnings: [expect.anything()],
      });
    });
  });

  describe("fails", () => {
    it("when the feed fails", async () => {
      const { domicile } = answering({
        [FEED]: response(503, "Unavailable", FEED),
      });

      await expect(readInbox(domicile, EMAIL, neverWarns)).rejects.toThrow(
        "503",
      );
    });

    it("when the feed has no count", async () => {
      const { domicile } = answering({
        [FEED]: response(
          200,
          "<feed><title>Inbox for me@example.com</title></feed>",
          FEED,
        ),
      });

      await expect(readInbox(domicile, EMAIL, neverWarns)).rejects.toThrow();
    });
  });
});
