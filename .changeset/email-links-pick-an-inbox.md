---
"@domicile-desktop/manganese": minor
"@domicile-desktop/manganese-notifications": minor
"@domicile-desktop/manganese-page-requests": minor
"@domicile-desktop/manganese-inbox-gmail": minor
"@domicile-desktop/manganese-bar-module-gmail": minor
---

Email links ask which inbox, and which of its addresses, to write from, then open a new message in that inbox's window. `Inbox.Watched` takes a `write`; `gmailInbox` writes from the account and its Gmail aliases. Reading the aliases needs the `gmail.settings.basic` scope, so each Gmail account signs in again once.
