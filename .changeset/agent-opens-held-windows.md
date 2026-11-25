---
"domicile": minor
"@domicile-desktop/manganese-window-management": minor
---

`domicile exec --agent <session>` and `domicile open --agent <session>` start a program whose windows open held by the agent's seat, without an activation token. The MCP server's `exec` and `open` use them. Manganese opens a window an agent holds without taking the user's focus.
