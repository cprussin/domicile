import { describe, expect, it } from "bun:test";
import { watchUnread } from "@domicile-desktop/manganese-bar-module-google-messages/watch-unread";
import { InboxKind } from "@domicile-desktop/manganese-notifications/inbox";

import { messagesInbox } from "./messages-inbox";

describe(messagesInbox, () => {
  it("is Messages' page, counted from the page", () => {
    expect(messagesInbox()).toMatchObject({
      countUnread: watchUnread,
      kind: InboxKind.Page,
      name: "Messages",
      url: "https://messages.google.com/web/",
    });
  });
});
