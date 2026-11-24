---
"@domicile-desktop/ci": patch
---

A Chromium tree copied after a pin roll now starts warm: the copy carries the build tool's saved state over to its own path, so its first build takes minutes instead of re-running every step.
