---
"domicile": patch
---

Apps no longer crash when a display goes away, such as a TV the desk extended onto. The compositor withdraws a removed display's `wl_output` first and frees it a few seconds later, so an app that binds it in the meantime keeps running.
