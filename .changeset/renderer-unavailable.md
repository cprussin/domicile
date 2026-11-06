---
"@domicile-desktop/engine": patch
"domicile": patch
---

A tty desktop whose graphics card cannot draw, even on the CPU, no longer restarts its GPU process forever on a black screen. Chromium's GPU crash limit is back on, and when no GPU mode works `domicile` stops with "renderer unavailable" and exit code 69.
