---
"@domicile-desktop/manganese": minor
"@domicile-desktop/manganese-notifications": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese-launcher": minor
"@domicile-desktop/manganese-inbox-gmail": minor
"@domicile-desktop/manganese-inbox-google-messages": minor
"@domicile-desktop/manganese-bar-module-gmail": minor
"@domicile-desktop/manganese-bar-module-google-messages": minor
---

Inboxes open as app windows instead of a page in the notifications drawer. Messages is one window that keeps running in the background: closing it hides it. Each Gmail account has one window, reused by its inbox row, its bar counter and its new-mail notifications. `Inbox.Page` is replaced by `Inbox.Window`, and an inbox's `launcherName` adds a launcher entry that opens its window.
