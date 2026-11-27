---
"@domicile-desktop/engine": patch
"domicile": patch
---

An extension switched back on while it reloads comes back on, and a hidden page draws its new colors however long a busy page takes. A `<webview>` logs whether each new surface it embeds waits for its page, and how long its tooltip waited. A keystroke-to-pixel run starts once the engine takes the window's frame, even with no commit after it.
