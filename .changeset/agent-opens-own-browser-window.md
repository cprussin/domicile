---
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/component-library": patch
"@domicile-desktop/manganese-bar-module-gmail": patch
---

`domicile open --agent <session> <url>` opens a new browser window held by the agent's seat, listed with `agent` so the shell opens it without the user's focus; the engine's `open_url` answers with the window's id. Manganese opens a window an agent holds in a group of its own beside the user's. `domicile list-windows` gives browser windows `focused` and `size` from the engine's new `browser_windows` command.
