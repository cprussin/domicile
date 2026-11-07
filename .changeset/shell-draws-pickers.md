---
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese-page-requests": minor
---

A page's color, date and time pickers and a text box's suggestion list are now drawn by the shell, hung from the control, instead of by Chrome. `<webview>` fires `domicile-picker` with the control's kind, value, suggestions and box, answered with `choose()` or `cancel()`.
