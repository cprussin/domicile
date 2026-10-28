---
"@domicile-desktop/engine": patch
"@domicile-desktop/sdk": minor
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-bar-module-tray": patch
---

Extension popups size themselves as in Chrome: Blink's auto-resize, between 25x25 and 800x600. Phantom no longer grows wider on every layout, and Solflare gets its full 402x600. The tray shows a popup once its page has loaded, so it no longer opens narrow and then jumps. `contentWidth` and `contentHeight` report only for an `extensionpopup` view. `Popover` takes `withheld`, to lay a panel out before showing it.
