---
"@domicile-desktop/sdk": major
"@domicile-desktop/engine": major
"@domicile-desktop/manganese-window-management": patch
"domicile": patch
---

`domicile.pointer.warp(x, y, onlyOver, unlessOver)` moves the pointer only while it is over one of the `onlyOver` boxes and not over `unlessOver`; the engine checks. `onlyOver` is required. Manganese passes every other shown window's frame, so switching tabs or moving focus with the pointer over the top bar no longer warps it.
