---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-bar-module-gmail": minor
"@domicile-desktop/manganese-bar-module-google-messages": patch
"@domicile-desktop/manganese-bar-module-notifications": patch
---

Gmail's unread count is a badge on the item's end corner, like Messages and the notification bell; the item shows the inbox total. The badge is the new `CountBadge` component, which Messages and the bell now share. Messages caps its badge at "9+" and pops it in, as the bell does.
