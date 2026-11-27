---
"@domicile-desktop/engine": patch
"domicile": patch
---

The engine no longer loads Chrome's Gemini in Chrome and Contextual Tasks extensions. Each one started a background process of about 30 MiB in every browser profile whenever a page opened, and a desk has neither feature.
