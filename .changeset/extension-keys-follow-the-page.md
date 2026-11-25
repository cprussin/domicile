---
"@domicile-desktop/engine": patch
"domicile": patch
---

An extension's key pressed in a page runs its command in that page's browser profile, as in Chrome, and the page does not get it. A shell that listens for `extensioncommandpressed` runs it instead.
