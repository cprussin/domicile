---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-window-management": minor
---

Show a browser window's zoom and finished downloads in popups that hang from the address bar, as Chrome does. The downloads popup lists each file with Open, Show in folder and Remove from list, and the Downloaded indicator opens it again. `<webview>` gains `downloadCompletedPaths` and `removeCompletedDownload()`; `Popover` gains `anchor` and `quiet`; `ListRow` gains `endOnHover`.
