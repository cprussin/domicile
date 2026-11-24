---
"@domicile-desktop/engine": patch
"domicile": patch
---

A window's buffer the GPU read on several streams no longer crashes the compositor. A crashed compositor now restarts: the processes it started no longer hold its connection to the browser open.
