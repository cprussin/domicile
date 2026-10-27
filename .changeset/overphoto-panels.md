---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-notifications": patch
---

Panels over the wallpaper, such as the bar's popovers, stay dark in light mode. Everything in them, including buttons, fields and cards, now uses the dark theme's colors, so nothing is lost against the panel. Gray text is darker in light mode and lighter in dark mode, so it reads on cards. `CountBadge` takes `inline` to sit beside text.

The notifications popup uses the see-through panel, like quick settings. An inbox's unread count is a pill at the end of its row, in place of the total.
