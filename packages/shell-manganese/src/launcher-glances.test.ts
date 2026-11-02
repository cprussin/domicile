import { describe, expect, it } from "bun:test";
import { GlanceTone } from "@domicile-desktop/manganese-launcher/app-glance";
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
          status: { text: "3 unread", tone: GlanceTone.Waiting },
        },
      ],
      [
        "web-app:chat",
        {
          account: undefined,
          items: [],
          status: { text: "2 unread", tone: GlanceTone.Waiting },
        },
      ],
    ]);
  });

  it.each([
    [
      InboxReading.Counted(4, 0),
      { text: "No unread messages", tone: GlanceTone.Clear },
    ],
    [
      InboxReading.Unread(0),
      { text: "No unread messages", tone: GlanceTone.Clear },
    ],
    [
      InboxReading.SignedOut(),
      { text: "Not signed in", tone: GlanceTone.Note },
    ],
    [
      InboxReading.Failed("offline"),
      { text: "Couldn't check for new messages", tone: GlanceTone.Note },
    ],
    [undefined, undefined],
  ])("tells a reading of %p as %p", (reading, status) => {
    expect(
      launcherGlancesOf([MAIL], [reading], 0).get("web-app:mail")?.status,
    ).toStrictEqual(status);
  });
});
