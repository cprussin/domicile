---
"@domicile-desktop/engine": minor
"@domicile-desktop/electron-host": minor
"domicile": minor
---

Electron apps on the engine get `webContents.debugger` on a DevTools client of their own, and `takeHeapSnapshot`, `savePage` as MHTML, `insertText`, `stop`, `scrollToTop`, `scrollToBottom`, `getPrintersAsync`, `setImageAnimationPolicy`, `setWebRTCUDPPortRange`, `forcefullyCrashRenderer`, `saveVideoFrameAs` and `webFrameMain.collectJavaScriptCallStack`. A window that asks to be drawn offscreen is unsupported, so the app runs on its own Electron.
