---
"domicile": minor
"@domicile-desktop/system-apps": minor
"@domicile-desktop/manganese-launcher": patch
"@domicile-desktop/e2e-harness": patch
---

The launcher's "Open with…" now lists first the app Enter opens the file with, so the two always agree. `domicile open --which <file|url>` prints the app `domicile open` would run, and the desktop puts its own `domicile` first on its apps' `PATH`.
