---
"@domicile-desktop/engine": patch
"domicile": patch
---

The GPU process no longer runs without its seccomp filter, at random, when a thread it joined just before its sandbox started is still listed in `/proc`.
