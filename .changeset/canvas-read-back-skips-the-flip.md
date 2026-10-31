---
"@domicile-desktop/engine": patch
---

Reading pixels back from a page's canvas no longer waits for the screen to refresh on a tty, so pages that read many canvases no longer freeze.
