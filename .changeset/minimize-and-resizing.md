---
"@domicile-desktop/sdk": minor
"domicile": minor
"@domicile-desktop/manganese-window-management": patch
---

A client asking to be minimized now reaches the shell as `WindowRequest.Minimize`. The shell can also set `WindowState.Resizing` on a window while it resizes it, and the client sees `resizing` in its configure.
