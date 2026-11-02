import { describe, expect, it } from "bun:test";
import {
  Inbox,
  InboxReading,
} from "@domicile-desktop/manganese-notifications/inbox";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";

import { launcherGlancesOf } from "./launcher-glances";

const HOUR_MS = 60 * 60 * 1000;

const MAIL = Inbox.Watched({
  account: "me@example.com",
  app: { appId: "mail", url: "https://mail.example/" },
  icon: EnvelopeSimpleIcon,
  name: "Work",
  notifiesAs: "Work",
  open: () => undefined,
  read: () => sharedWatch(() => () => undefined),
});

const CHAT = Inbox.Window({
  appId: "chat",
  countUnread: () => () => undefined,
  icon: EnvelopeSimpleIcon,
  name: "Chat",
  notifiesAs: "chat.example.com",
  url: "https://chat.example.com/",
});

const NO_APP = Inbox.Watched({
  icon: EnvelopeSimpleIcon,
  name: "Feed",
  notifiesAs: "Feed",
  open: () => undefined,
  read: () => sharedWatch(() => () => undefined),
});

describe(launcherGlancesOf, () => {
  it("tells each launcher inbox's account, unread count and newest unread mail", () => {
    const glances = launcherGlancesOf(
      [NO_APP, MAIL, CHAT],
      [
        InboxReading.Unread(1),
        InboxReading.Counted(40, 3, [
          { from: "Alex", receivedAt: 2 * HOUR_MS, subject: "Dinner?" },
        ]),
        InboxReading.Unread(2),
      ],
      5 * HOUR_MS,
    );

    expect([...glances]).toStrictEqual([
      [
        "web-app:mail",
        {
          account: "me@example.com",
          items: [{ at: "3h", text: "Dinner?", title: "Alex" }],
          status: "3 unread",
        },
      ],
      ["web-app:chat", { account: undefined, items: [], status: "2 unread" }],
    ]);
  });

  it.each([
    [InboxReading.Counted(4, 0), "Nothing unread"],
    [InboxReading.Unread(0), "Nothing unread"],
    [InboxReading.SignedOut(), "Not signed in"],
    [InboxReading.Failed("offline"), "Couldn't check for new messages"],
    [undefined, undefined],
  ])("tells a reading of %p as %p", (reading, status) => {
    expect(
      launcherGlancesOf([MAIL], [reading], 0).get("web-app:mail")?.status,
    ).toBe(status);
  });
});
