---
"@domicile-desktop/sdk": minor
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/manganese-window-management": minor
---

A cursor an app draws itself, such as a game's, an image editor's brush or a VM viewer's, now shows in place of the arrow. The compositor sends each image the app commits as a PNG on `app_cursor`, and `DomicileWindow.cursorImage` gives it to the shell as a CSS `cursor` value. Manganese sets it on the window's element.
