---
"@domicile-desktop/component-library": major
"@domicile-desktop/manganese-bar-module-volume": patch
"@domicile-desktop/manganese-window-management": patch
---

Draw the Sound panel's device pickers as soft rows that match the panel.

- `component-library`: `Select` takes `surface`: `field` (the default), `filled` (a soft row sized like a panel's `ListRow`, with an up-and-down caret) or `quiet`. `surface="quiet"` replaces the `quiet` prop. Inside a panel over the wallpaper, its list is dark in either theme, as the panel is.
- `manganese-bar-module-volume`: the speaker, microphone, app and sound card pickers are `filled`.
- `manganese-window-management`: site permission pickers use `surface="quiet"`.
