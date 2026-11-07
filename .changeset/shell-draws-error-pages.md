---
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/manganese-window-management": minor
---

A page that can't load, has a certificate problem, is flagged as unsafe or crashes now shows a shell page with Try again, Go back or Continue anyway, instead of Chrome's own error and warning pages. `<webview>` reports why as `pageFailure` with `domicile-page-failure-change`, and `proceedPastWarning()` passes a warning.
