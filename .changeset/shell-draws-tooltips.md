---
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese-page-requests": minor
---

A page's tooltips, the "send the form again?" question on reload and the "page isn't responding" question are now the shell's, instead of Chrome's. `<webview>` reports its tooltip as `tooltip` with `domicile-tooltip-change`, and `domicile-prompt` gains the `resend-form` and `unresponsive` kinds. Reloading a page a form posted to used to do nothing; it now asks.
