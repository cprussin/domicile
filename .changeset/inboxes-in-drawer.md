---
"@domicile-desktop/manganese": minor
"@domicile-desktop/manganese-notifications": minor
"@domicile-desktop/manganese-inbox-gmail": minor
"@domicile-desktop/manganese-inbox-google-messages": minor
"@domicile-desktop/manganese-bar-module-gmail": minor
"@domicile-desktop/manganese-bar-module-google-messages": minor
"@domicile-desktop/component-library": minor
"@domicile-desktop/builder": patch
---

Inboxes in the notification drawer: `runManganese({ inboxes })` lists inboxes above the notifications, and their unread conversations count toward the bell. An inbox is plain data (`Inbox.Watched` or `Inbox.Page`, from `@domicile-desktop/manganese-notifications/inbox`). New packages `@domicile-desktop/manganese-inbox-gmail` (`gmailInbox`) and `@domicile-desktop/manganese-inbox-google-messages` (`messagesInbox`, which opens in the drawer, widened, with a back button). The Gmail and Google Messages bar items stay, and export what the inboxes share. `SlideOver` gains `keepMounted`, `onBack` and `wide`.
