---
"@domicile-desktop/manganese-bar-module-gmail": major
"@domicile-desktop/manganese-inbox-gmail": minor
---

New Gmail mail raises a desktop notification: the account's nickname, the sender and the subject, or one "5 new emails" notification when more than 3 arrive at once. A press opens the message. Mail already unread at startup or sign-in is not notified. Reading headers needs the `gmail.metadata` scope, so each account signs in again once. `deskInbox(domicile)(email, client, nickname)` takes the nickname notifications use.
