import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { deskInbox } from "./desk-inbox";

describe("deskInbox", () => {
  it("is one watch per account on a desk", () => {
    const inboxes = deskInbox(new FakeDomicileHost().host);

    expect(inboxes("me@example.com")).toBe(inboxes("me@example.com"));
    expect(inboxes("me@example.com")).not.toBe(inboxes("you@example.com"));
  });

  it("reads the account through the desk", () => {
    const fake = new FakeDomicileHost();

    const stop = deskInbox(fake.host)("me@example.com").subscribe(
      () => undefined,
    );
    stop();

    expect(fake.calls).toStrictEqual([
      [
        "fetchWithCookies",
        "https://mail.google.com/mail/feed/atom?authuser=me%40example.com",
        [],
        null,
      ],
    ]);
  });
});
