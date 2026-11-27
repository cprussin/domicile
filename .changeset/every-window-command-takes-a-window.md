---
"domicile": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese": minor
---

Every command and MCP tool that acts on a window takes the window's id, and acts on the driver's focus without one: an agent's own focus for an agent. `close-window`, `kill-window`, `accessibility`, `accessibility-act` and `devtools` take it as `--window <id>`, and `close_window` takes `window`. Manganese runs any window command on a named window.
