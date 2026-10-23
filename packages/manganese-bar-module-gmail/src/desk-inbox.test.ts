import { describe, expect, it, jest } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { inboxAddress } from "./addresses";
import { consentAddress } from "./consent";
import { deskInbox } from "./desk-inbox";
import { CLIENT, EMAIL } from "./held-google";
import { Inbox } from "./inbox";

describe("deskInbox", () => {
  it("is one watch per account on a desk", () => {
    const inboxes = deskInbox(new FakeDomicileHost().host);

    expect(inboxes(EMAIL, CLIENT)).toBe(inboxes(EMAIL, CLIENT));
    expect(inboxes(EMAIL, CLIENT)).not.toBe(inboxes("you@example.com", CLIENT));
  });

  it("is signed out before the account signs in", async () => {
    const { inbox } = deskInbox(new FakeDomicileHost().host)(EMAIL, CLIENT);

    const reading = await new Promise((resolve) => {
      const stop = inbox.subscribe(() => {
        resolve(inbox.current());
        stop();
      });
    });

    expect(reading).toStrictEqual(Inbox.SignedOut());
  });

  it("signs in through Google's consent", () => {
    const fake = new FakeDomicileHost();
    const account = deskInbox(fake.host)(EMAIL, CLIENT);

    const stop = account.inbox.subscribe(() => undefined);
    account.signIn();
    stop();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.[0]).toBe("openBrowserWindow");
    expect(String(fake.calls[0]?.[1])).toStartWith(
      consentAddress(CLIENT, EMAIL, ""),
    );
  });

  it("reads again a second after a Gmail window changes", async () => {
    jest.useFakeTimers();
    const fake = new FakeDomicileHost();
    const { inbox } = deskInbox(fake.host)(EMAIL, CLIENT);
    const readings = { count: 0 };

    const stop = inbox.subscribe(() => {
      readings.count += 1;
    });
    await Promise.resolve();
    fake.openBrowser(inboxAddress(EMAIL));
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    stop();
    jest.useRealTimers();

    expect(readings.count).toBe(2);
  });
});
