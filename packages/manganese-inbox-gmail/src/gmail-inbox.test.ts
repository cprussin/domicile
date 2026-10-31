import { describe, expect, it } from "bun:test";
import {
  InboxKind,
  InboxReading,
} from "@domicile-desktop/manganese-notifications/inbox";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { gmailInbox } from "./gmail-inbox";

const CLIENT = { id: "client.apps.googleusercontent.com", secret: "s3cret" };
const EMAIL = "me@example.com";

const inbox = () => {
  const made = gmailInbox({ client: CLIENT, email: EMAIL, nickname: "Work" });
  if (made.kind === InboxKind.Watched) {
    return made;
  } else {
    throw new Error("a Gmail inbox is read from outside");
  }
};

describe(gmailInbox, () => {
  it("is named by its nickname", () => {
    expect(inbox().name).toBe("Work");
  });

  it("notifies new mail under its nickname", () => {
    expect(inbox().notifiesAs).toBe("Work");
  });

  it("reads signed out before the account signs in", async () => {
    const watch = inbox().read(new FakeDomicileHost().domicile);

    const reading = await new Promise((resolve) => {
      const stop = watch.subscribe(() => {
        resolve(watch.current());
        stop();
      });
    });

    expect(reading).toStrictEqual(InboxReading.SignedOut());
  });

  it("is one watch per desktop", () => {
    const { domicile } = new FakeDomicileHost();
    const gmail = inbox();

    expect(gmail.read(domicile)).toBe(gmail.read(domicile));
  });

  it("signs a signed-out account in", () => {
    const fake = new FakeDomicileHost();
    const gmail = inbox();
    const stop = gmail.read(fake.domicile).subscribe(() => undefined);

    gmail.open(fake.domicile, InboxReading.SignedOut());
    stop();

    expect(fake.calls[0]?.[0]).toBe("openBrowserWindow");
    expect(String(fake.calls[0]?.[1])).toStartWith(
      "https://accounts.google.com/",
    );
  });

  it("opens the account's inbox in its own Gmail window, or brings it up", () => {
    const fake = new FakeDomicileHost();

    inbox().open(fake.domicile, InboxReading.Counted(12, 3));

    expect(fake.calls).toEqual([
      [
        "openAppWindow",
        "https://mail.google.com/mail/?authuser=me%40example.com",
        "gmail:me@example.com",
        "focus",
      ],
    ]);
  });

  it("is listed in the launcher by the name given, else its nickname, as its window", () => {
    expect(inbox().launcherName).toBeUndefined();
    expect(inbox().app).toEqual({
      appId: "gmail:me@example.com",
      url: "https://mail.google.com/mail/?authuser=me%40example.com",
    });
    expect(
      gmailInbox({
        client: CLIENT,
        email: EMAIL,
        launcherName: "Email - Work",
        nickname: "Work",
      }).launcherName,
    ).toBe("Email - Work");
  });
});
