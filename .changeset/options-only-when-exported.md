---
"@domicile-desktop/builder": patch
---

A shell that exports no `options` is no longer run at build time, so a library that touches `document` on import no longer fails the build.
