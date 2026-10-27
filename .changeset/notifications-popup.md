---
"@domicile-desktop/manganese-notifications": minor
"@domicile-desktop/manganese-bar-module-notifications": minor
"@domicile-desktop/manganese": patch
"@domicile-desktop/manganese-window-management": patch
---

The notification drawer opens as a panel under the bell, like quick settings, instead of sliding in from the screen's edge. Its sections have clearer headings, inbox rows are tighter, and each notification sits on its own tile. "Clear all" is in a quieter footer. An inbox's page, such as Messages, widens the panel and has a back button.

`NotificationsDrawer` (from `notifications-context`) now holds a popover `handle` that every bell opens, in place of `open(screen)`. `NotificationDrawer` takes `handle`, `onOpen(screen)` and `onClose()` in place of `onOpenChange`.
