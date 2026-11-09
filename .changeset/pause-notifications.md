---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-notifications": major
"@domicile-desktop/manganese-bar-module-notifications": major
"@domicile-desktop/manganese": minor
"@domicile-desktop/site": patch
---

The notifications panel's Do not disturb switch is now a Pause button in its header. Pause for 1 hour, until 8 AM tomorrow, or until you resume; the header says until when, and Resume ends it early. Clear all moves beside the Recent label. Do not disturb left on carries over as a pause until resumed.

- `useNotifications` returns `pause`, `pauseFor` and `resume` in place of `doNotDisturb` and `setDoNotDisturb`.
- `NotificationDrawer` takes `pause`, `onPause` and `onResume` in place of `doNotDisturb` and `onDoNotDisturb`; `NotificationBell` and the drawer context take `paused`.
- The component library adds `Menu`, a menu opened from a button, and a `status` line on `PanelHeader`.
