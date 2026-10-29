import { describe, expect, it } from "bun:test";
import { None } from "@cprussin/option-result";
import { SCOPE } from "./consent";
import type { Mail, MailNews } from "./gmail-api";
import {
  answering,
  CLIENT,
  EMAIL,
  HEADERS,
  heldStorage,
  INBOX,
  json,
  TOKEN,
  UNREAD,
} from "./held-google";
import { Inbox } from "./inbox";
import { inboxReader } from "./read-inbox";
import { storedToken, storeToken } from "./stored-token";

const HOUR_MS = 60 * 60 * 1000;

const ACCESS = json(200, {
  access_token: "a",
  expires_in: 3600,
  scope: SCOPE,
});

const counted = (unread: number, total: number) =>
  json(200, { threadsTotal: total, threadsUnread: unread });

/** Gmail's list of unread messages, newest first. */
const unread = (...ids: readonly string[]) =>
  json(200, { messages: ids.map((id) => ({ id, threadId: `t-${id}` })) });

/** Gmail's sender and subject of message `id`. */
const headers = (id: string) =>
  json(200, {
    id,
    payload: {
      headers: [
        { name: "From", value: `Sender ${id}` },
        { name: "Subject", value: `Subject ${id}` },
      ],
    },
    threadId: `t-${id}`,
  });

const mail = (id: string): Mail => ({
  from: `Sender ${id}`,
  id,
  subject: `Subject ${id}`,
  threadId: `t-${id}`,
});

const ignored = () => Promise.resolve();

/** An `onMail` that keeps what it is told. */
const heldMail = () => {
  const told: MailNews[] = [];
  return {
    onMail: (news: MailNews) => {
      told.push(news);
      return Promise.resolve();
    },
    told,
  };
};

/** A store holding the account's refresh token. */
const signedIn = () => {
  const storage = heldStorage();
  storeToken(EMAIL, "r", storage);
  return storage;
};

/** A clock the test moves. */
const heldClock = () => {
  const clock = { now: 0 };
  return { clock, now: () => clock.now };
};

const tokenAsks = (fetched: ReturnType<typeof answering>["fetched"]) =>
  fetched.filter((one) => one.url === TOKEN).length;

describe("inboxReader", () => {
  it("is signed out before the account signs in, and asks nothing", async () => {
    const { domicile, fetched } = answering({});

    expect(
      await inboxReader(domicile, CLIENT, EMAIL, ignored, heldStorage())(),
    ).toStrictEqual(Inbox.SignedOut());
    expect(fetched).toHaveLength(0);
  });

  it("counts the inbox's conversations", async () => {
    const { domicile } = answering({
      [INBOX]: [counted(2, 4)],
      [UNREAD]: [unread()],
      [TOKEN]: [ACCESS],
    });

    expect(
      await inboxReader(domicile, CLIENT, EMAIL, ignored, signedIn())(),
    ).toStrictEqual(Inbox.Counted(4, 2));
  });

  it("keeps the access token until it expires", async () => {
    const { domicile, fetched } = answering({
      [INBOX]: [counted(2, 4)],
      [UNREAD]: [unread()],
      [TOKEN]: [ACCESS],
    });
    const { clock, now } = heldClock();
    const read = inboxReader(domicile, CLIENT, EMAIL, ignored, signedIn(), now);

    await read();
    await read();
    expect(tokenAsks(fetched)).toBe(1);

    clock.now = HOUR_MS;
    await read();
    expect(tokenAsks(fetched)).toBe(2);
  });

  it("is signed out, and forgets the token, once Google revokes it", async () => {
    const { domicile } = answering({
      [TOKEN]: [json(400, { error: "invalid_grant" })],
    });
    const storage = signedIn();

    expect(
      await inboxReader(domicile, CLIENT, EMAIL, ignored, storage)(),
    ).toStrictEqual(Inbox.SignedOut());
    expect(storedToken(EMAIL, storage)).toStrictEqual(None());
  });

  it("fails when Google gives no access token", async () => {
    const { domicile } = answering({
      [TOKEN]: [json(401, { error: "invalid_client" })],
    });

    await expect(
      inboxReader(domicile, CLIENT, EMAIL, ignored, signedIn())(),
    ).rejects.toThrow("invalid_client");
  });

  it("fails when Gmail refuses, and asks for a new access token after", async () => {
    const { domicile, fetched } = answering({
      [INBOX]: [json(401, { error: { code: 401 } }), counted(1, 4)],
      [UNREAD]: [unread()],
      [TOKEN]: [ACCESS],
    });
    const read = inboxReader(domicile, CLIENT, EMAIL, ignored, signedIn());

    await expect(read()).rejects.toThrow("Gmail answered 401");
    expect(await read()).toStrictEqual(Inbox.Counted(4, 1));
    expect(tokenAsks(fetched)).toBe(2);
  });

  describe("new mail", () => {
    it("tells of none already unread at the first read", async () => {
      const { domicile } = answering({
        [INBOX]: [counted(1, 4)],
        [TOKEN]: [ACCESS],
        [UNREAD]: [unread("m1")],
      });
      const { onMail, told } = heldMail();

      await inboxReader(domicile, CLIENT, EMAIL, onMail, signedIn())();

      expect(told).toStrictEqual([]);
    });

    it("tells of each message that arrives after, once, and of each read after", async () => {
      const { domicile } = answering({
        [HEADERS("m2")]: [headers("m2")],
        [HEADERS("m3")]: [headers("m3")],
        [INBOX]: [counted(1, 4)],
        [TOKEN]: [ACCESS],
        [UNREAD]: [unread("m1"), unread("m3", "m2", "m1"), unread("m3", "m1")],
      });
      const { onMail, told } = heldMail();
      const read = inboxReader(domicile, CLIENT, EMAIL, onMail, signedIn());

      await read();
      await read();
      await read();

      expect(told).toStrictEqual([
        { arrived: [mail("m3"), mail("m2")], read: [] },
        { arrived: [], read: ["m2"] },
      ]);
    });

    it("tells of none already unread when the account signs in again", async () => {
      const { domicile } = answering({
        [INBOX]: [counted(1, 4)],
        [TOKEN]: [ACCESS, json(400, { error: "invalid_grant" }), ACCESS],
        [UNREAD]: [unread("m1"), unread("m2", "m1")],
      });
      const { onMail, told } = heldMail();
      const { clock, now } = heldClock();
      const storage = signedIn();
      const read = inboxReader(domicile, CLIENT, EMAIL, onMail, storage, now);

      await read();
      clock.now = HOUR_MS;
      expect(await read()).toStrictEqual(Inbox.SignedOut());
      storeToken(EMAIL, "r", storage);
      await read();

      expect(told).toStrictEqual([]);
    });

    it("fails when Gmail gives no sender and subject", async () => {
      const { domicile } = answering({
        [HEADERS("m2")]: [json(404, { error: { code: 404 } })],
        [INBOX]: [counted(1, 4)],
        [TOKEN]: [ACCESS],
        [UNREAD]: [unread("m1"), unread("m2", "m1")],
      });
      const read = inboxReader(domicile, CLIENT, EMAIL, ignored, signedIn());

      await read();

      await expect(read()).rejects.toThrow("Gmail answered 404");
    });
  });
});
