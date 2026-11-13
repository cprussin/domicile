---
"domicile": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/system-apps": minor
"@domicile-desktop/manganese-launcher": minor
"@domicile-desktop/manganese-window-management": minor
---

The config can name a terminal with `terminal`, such as `["kitty"]`. When it does, applications that run in a terminal, such as htop and vim, show up in the launcher and under "Open with", and `domicile open` runs them in it. Meta+Return opens it in Manganese. Without one, nothing changes: Domicile still has no default terminal.
