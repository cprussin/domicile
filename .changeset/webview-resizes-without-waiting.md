---
"domicile": patch
"@domicile-desktop/manganese-host": patch
"@domicile-desktop/manganese-window-management": patch
"@domicile-desktop/sdk": patch
---

Dragging a browser window's edge no longer holds the whole desktop to the page's pace. While a `<webview>` has the `resizing` attribute, as an `<app>` already could, the page's latest frame stretches to each new box at once instead of the desktop waiting for the page to draw at it. Manganese sets it on every browser window during a resize.
