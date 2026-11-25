---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"domicile": minor
---

Browser windows no `<webview>` shows, or whose `<webview>` is not rendered, have their pages unloaded while the computer is short of memory, much as Chrome unloads tabs, and load again when they are shown. Shells get `isDiscarded` on a window, `browser.discard(id)` to unload one by hand, and `browser.on("memoryShort", …)` to decide themselves which go.
