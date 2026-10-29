import { describe, expect, it } from "bun:test";
import { watchUnreadWith } from "@domicile-desktop/manganese-bar-module-google-messages/watch-unread";
import { InboxKind } from "@domicile-desktop/manganese-notifications/inbox";

import { messagesInbox } from "./messages-inbox";

describe(messagesInbox, () => {
  it("is Messages' one window, counted from the window", () => {
    expect(messagesInbox()).toMatchObject({
      appId: "google-messages",
      countUnread: watchUnreadWith,
      kind: InboxKind.Window,
      name: "Messages",
      url: "https://messages.google.com/web/",
    });
  });

  it("is listed in the launcher by the name given", () => {
    expect(messagesInbox().launcherName).toBeUndefined();
    expect(messagesInbox({ launcherName: "SMS" }).launcherName).toBe("SMS");
  });
});
