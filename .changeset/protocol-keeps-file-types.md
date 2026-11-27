---
"@domicile-desktop/electron-host": patch
---

A file an Electron app's protocol handler fetches keeps its Content-Type, so VSCodium's workbench loads on a fresh start instead of stopping at its splash.
