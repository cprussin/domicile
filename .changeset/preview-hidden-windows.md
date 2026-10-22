---
"@domicile-desktop/component-library": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/system-apps": patch
"domicile": minor
---

The screenshot and screen share pickers draw a window that is not on screen, such as a tab behind another, in place of the desk when it is picked. `System.previewWindow` draws one, through the compositor's new `preview_window` system call.
