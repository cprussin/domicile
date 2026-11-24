---
"@domicile-desktop/electron-host": patch
---

`webContents.getLastWebPreferences()` returns the page's webPreferences with the defaults it runs with. Slack calls it on every new window, and its window never opened without it.
