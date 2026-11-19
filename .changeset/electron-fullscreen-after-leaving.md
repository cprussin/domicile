---
"@domicile-desktop/electron-host": patch
---

An Electron app's window goes fullscreen again when the app asks after the user left fullscreen with the desktop: the engine now hears that the app no longer wants it, so the next ask is a change the shell acts on.
