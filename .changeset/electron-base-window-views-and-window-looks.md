---
"@domicile-desktop/electron-host": minor
---

`BaseWindow`, `View` and `ImageView` work, as do views nested in views, `setContentView` and a `BrowserWindow`'s own `contentView`. `flashFrame`, `setIgnoreMouseEvents` and `setShape` reach the shell instead of doing nothing, windows hear `app-command` from the mouse's back and forward buttons, and `getMediaSourceId` names a window that `getUserMedia` captures.
