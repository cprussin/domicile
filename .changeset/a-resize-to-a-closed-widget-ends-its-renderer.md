---
"@domicile-desktop/engine": patch
"domicile": patch
---

A page whose renderer stopped taking resizes crashes and offers a reload on the next resize or move, instead of hanging. This ends the whole renderer process, so other pages that share it crash too. The engine logs the page's origin and why the connection closed.
