import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { gmailAppId, inboxAddress } from "./addresses";
import { EMAIL } from "./held-google";
import type { MailBrowser } from "./open-mail";
import { openMail } from "./open-mail";

const INBOX = "https://mail.google.com/mail/u/0/#inbox";

/** A host with the account's Gmail window open at `url`. */
const withGmail = (url: string): FakeDomicileHost => {
  const fake = new FakeDomicileHost();
  fake.openBrowser(url, { appId: gmailAppId(EMAIL), isApp: true });
  return fake;
};

/** Every window's page goes to `url`. */
const load = (fake: FakeDomicileHost, url: string): void => {
  fake.set({
    browserWindows: (fake.host.browserWindows ?? []).map((window) => ({
      ...window,
      url,
    })),
  });
};

const navigations = (fake: FakeDomicileHost) =>
  fake.calls.filter(
    ([method, , , reuse]) => method === "openAppWindow" && reuse === "navigate",
  );

describe("openMail", () => {
  it("changes only the open Gmail page's hash, as a click in Gmail does", () => {
    const fake = withGmail("https://mail.google.com/mail/u/1/#label/work");

    openMail(fake.domicile.browser, EMAIL, "#inbox/t1");

    expect(navigations(fake)).toStrictEqual([
      [
        "openAppWindow",
        "https://mail.google.com/mail/u/1/#inbox/t1",
        gmailAppId(EMAIL),
        "navigate",
        "",
      ],
    ]);
  });

  it("loads the inbox, then goes to the place once Gmail has started", () => {
    const fake = withGmail("https://mail.google.com/chat/u/0/#chat/home");

    openMail(fake.domicile.browser, EMAIL, "#inbox/t1");
    load(fake, "https://accounts.google.com/signin");
    load(fake, "https://mail.google.com/mail/u/0/");
    load(fake, INBOX);

    expect(navigations(fake).map(([, url]) => url)).toStrictEqual([
      inboxAddress(EMAIL),
      `${INBOX}/t1`,
    ]);
  });

  it("waits for a window the browser lists later", () => {
    const fake = new FakeDomicileHost();
    const { browser } = fake.domicile;
    const opened: string[] = [];
    const unlisted: MailBrowser = {
      on: browser.on,
      openApp: (url) => {
        opened.push(url);
      },
      get windows() {
        return browser.windows;
      },
    };

    openMail(unlisted, EMAIL, "#inbox/t1");
    fake.openBrowser(INBOX, { appId: gmailAppId(EMAIL), isApp: true });

    expect(opened).toStrictEqual([inboxAddress(EMAIL), `${INBOX}/t1`]);
  });

  it("forgets the place when the window closes before Gmail starts, or once stopped", () => {
    const closed = new FakeDomicileHost();
    const stopped = new FakeDomicileHost();

    openMail(closed.domicile.browser, EMAIL, "#inbox/t1");
    closed.set({ browserWindows: [] });
    closed.openBrowser(INBOX, { appId: gmailAppId(EMAIL), isApp: true });
    openMail(stopped.domicile.browser, EMAIL, "#inbox/t1")();
    load(stopped, INBOX);

    expect(navigations(closed)).toHaveLength(1);
    expect(navigations(stopped)).toHaveLength(1);
  });
});
