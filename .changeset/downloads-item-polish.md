---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-bar": minor
"@domicile-desktop/manganese-bar-module-downloads": minor
"@domicile-desktop/manganese-bar-module-google-messages": patch
"@domicile-desktop/manganese-launcher": minor
"@domicile-desktop/manganese-lock": patch
"@domicile-desktop/manganese-notifications": patch
"@domicile-desktop/manganese-quick-settings": patch
"@domicile-desktop/manganese": minor
"@domicile-desktop/system-apps": minor
---

The Downloads bar item's panel opens by itself as a download starts, on the screen with the keyboard, and stays until dismissed. Removed downloads slide out as cleared notifications do. As the last download finishes, the item eases from its percent to a check and "Done", then back to its icon. Opening a file no app opens says so, in the downloads panel and in the launcher, instead of doing nothing.

- `LeavingRow` and `useLeavingRows` (component library) hold the notification drawer's arrive and leave motion; `ListRow` takes it as `motion`.
- `Bar` has `popsUp`: whether an item may open its panel by itself.
- `opens` and `nothingOpens` (`@domicile-desktop/system-apps/opens`) ask `domicile open --which` before opening a file.
- `Launcher` takes `opens`.
