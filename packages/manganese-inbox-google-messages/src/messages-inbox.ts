import { watchUnread } from "@domicile-desktop/manganese-bar-module-google-messages/watch-unread";
import { Inbox } from "@domicile-desktop/manganese-notifications/inbox";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/ssr/ChatCircleText";

/**
 * Google Messages in the notification drawer: its page, opened in the drawer,
 * with its unread conversations counted toward the bell. Goes in
 * `runManganese`'s `inboxes`.
 */
export const messagesInbox = (): Inbox =>
  Inbox.Page({
    countUnread: watchUnread,
    icon: ChatCircleTextIcon,
    name: "Messages",
    url: "https://messages.google.com/web/",
  });
