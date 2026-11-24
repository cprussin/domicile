---
"@domicile-desktop/ci": patch
---

After main's engine release builds at a new Chromium pin, it copies its built tree over the other tree on the build machine, so the next run there starts warm instead of rebuilding Chromium for hours. The copy shares disk blocks and skips any tree in use.
