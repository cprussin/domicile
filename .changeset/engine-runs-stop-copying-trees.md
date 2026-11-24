---
"@domicile-desktop/ci": patch
---

Main's engine release no longer copies its built tree over the other tree after a Chromium pin roll. On the build machine the disk quota charges the copy at full size, so it filled the disk instead of saving a rebuild.
