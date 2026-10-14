import { describe, expect, it } from "bun:test";

import {
  answering,
  EMAIL,
  PAGE,
  page,
  response,
  SYNC,
  synced,
} from "./held-gmail";
import { Inbox } from "./inbox";
import { inboxReader } from "./read-inbox";

const SIGNED_IN = response(200, page(), "https://mail.google.com/mail/u/2/");

const HOUR_MS = 60 * 60 * 1000;

/** A clock the test moves. */
const heldClock = () => {
  const clock = { now: 0 };
  return { clock, now: () => clock.now };
};

const pageReads = (fetched: ReturnType<typeof answering>["fetched"]) =>
  fetched.filter((one) => one.url === PAGE).length;

describe("inboxReader", () => {
  it("is signed out when the page says so, and syncs nothing", async () => {
    const { domicile, fetched } = answering({
      [PAGE]: [
        response(200, "<html></html>", "https://accounts.google.com/signin"),
      ],
    });

    expect(await inboxReader(domicile, EMAIL)()).toStrictEqual(
      Inbox.SignedOut(),
    );
    expect(fetched).toHaveLength(1);
  });

  it("counts the inbox's conversations", async () => {
    const { domicile } = answering({
      [PAGE]: [SIGNED_IN],
      [SYNC]: [response(200, synced(2, 4), SYNC)],
    });

    expect(await inboxReader(domicile, EMAIL)()).toStrictEqual(
      Inbox.Counted(4, 2),
    );
  });

  it("reads the page once for the polls after it", async () => {
    const { domicile, fetched } = answering({
      [PAGE]: [SIGNED_IN],
      [SYNC]: [response(200, synced(2, 4), SYNC)],
    });
    const read = inboxReader(domicile, EMAIL);

    await read();
    await read();

    expect(pageReads(fetched)).toBe(1);
  });

  it("reads the page again after an hour", async () => {
    const { domicile, fetched } = answering({
      [PAGE]: [SIGNED_IN],
      [SYNC]: [response(200, synced(2, 4), SYNC)],
    });
    const { clock, now } = heldClock();
    const read = inboxReader(domicile, EMAIL, now);

    await read();
    clock.now = HOUR_MS;
    await read();

    expect(pageReads(fetched)).toBe(2);
  });

  it("reads the page again when a sync fails, and syncs again", async () => {
    const { domicile, fetched } = answering({
      [PAGE]: [SIGNED_IN],
      [SYNC]: [
        response(200, synced(2, 4), SYNC),
        response(200, JSON.stringify(["er", null, null, 500]), SYNC),
        response(200, synced(1, 4), SYNC),
      ],
    });
    const read = inboxReader(domicile, EMAIL);

    await read();

    expect(await read()).toStrictEqual(Inbox.Counted(4, 1));
    expect(pageReads(fetched)).toBe(2);
  });

  it("fails when the sync fails on a fresh page too", async () => {
    const { domicile } = answering({
      [PAGE]: [SIGNED_IN],
      [SYNC]: [response(403, "Forbidden", SYNC)],
    });

    await expect(inboxReader(domicile, EMAIL)()).rejects.toThrow("403");
  });
});
