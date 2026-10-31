---
"@domicile-desktop/manganese": patch
"@domicile-desktop/manganese-notifications": minor
"@domicile-desktop/manganese-inbox-gmail": patch
"@domicile-desktop/manganese-inbox-google-messages": patch
---

The bell counts an inbox's new mail or texts once: its own notifications stay out of the count, since its unread conversations already add to it. Every inbox names the sender its notifications arrive under, `notifiesAs`, and `useNotifications` takes the senders to leave out.
