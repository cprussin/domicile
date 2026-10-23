---
"@domicile-desktop/sdk": minor
"@domicile-desktop/manganese-window-management": patch
"@domicile-desktop/component-library": patch
"@domicile-desktop/manganese": patch
"domicile": patch
---

A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
