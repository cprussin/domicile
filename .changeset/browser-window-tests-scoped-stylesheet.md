---
"@domicile-desktop/manganese-window-management": patch
"@domicile-desktop/test-support": patch
---

`loadEmittedStylesheet` removes its stylesheet once the enclosing file or `describe` has run. Test files share one document, so stylesheets left behind slowed every later file's style lookups until `BrowserWindow`'s context-menu tests timed out in CI. `BrowserWindow`'s tests load it only where they read a style.
