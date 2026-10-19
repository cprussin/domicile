import { describe, expect, it } from "bun:test";
import { None } from "@cprussin/option-result";

import {
  answering,
  CLIENT,
  EMAIL,
  heldStorage,
  INBOX,
  json,
  TOKEN,
} from "./held-google";
import { Inbox } from "./inbox";
import { inboxReader } from "./read-inbox";
import { storedToken, storeToken } from "./stored-token";

const HOUR_MS = 60 * 60 * 1000;

const ACCESS = json(200, { access_token: "a", expires_in: 3600 });

const counted = (unread: number, total: number) =>
  json(200, { threadsTotal: total, threadsUnread: unread });

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
      await inboxReader(domicile, CLIENT, EMAIL, heldStorage())(),
    ).toStrictEqual(Inbox.SignedOut());
    expect(fetched).toHaveLength(0);
  });

  it("counts the inbox's conversations", async () => {
    const { domicile } = answering({
      [INBOX]: [counted(2, 4)],
      [TOKEN]: [ACCESS],
    });

    expect(
      await inboxReader(domicile, CLIENT, EMAIL, signedIn())(),
    ).toStrictEqual(Inbox.Counted(4, 2));
  });

  it("keeps the access token until it expires", async () => {
    const { domicile, fetched } = answering({
      [INBOX]: [counted(2, 4)],
      [TOKEN]: [ACCESS],
    });
    const { clock, now } = heldClock();
    const read = inboxReader(domicile, CLIENT, EMAIL, signedIn(), now);

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

    expect(await inboxReader(domicile, CLIENT, EMAIL, storage)()).toStrictEqual(
      Inbox.SignedOut(),
    );
    expect(storedToken(EMAIL, storage)).toStrictEqual(None());
  });

  it("fails when Google gives no access token", async () => {
    const { domicile } = answering({
      [TOKEN]: [json(401, { error: "invalid_client" })],
    });

    await expect(
      inboxReader(domicile, CLIENT, EMAIL, signedIn())(),
    ).rejects.toThrow("invalid_client");
  });

  it("fails when Gmail refuses, and asks for a new access token after", async () => {
    const { domicile, fetched } = answering({
      [INBOX]: [json(401, { error: { code: 401 } }), counted(1, 4)],
      [TOKEN]: [ACCESS],
    });
    const read = inboxReader(domicile, CLIENT, EMAIL, signedIn());

    await expect(read()).rejects.toThrow("Gmail answered 401");
    expect(await read()).toStrictEqual(Inbox.Counted(4, 1));
    expect(tokenAsks(fetched)).toBe(2);
  });
});
