---
"domicile": minor
---

Each agent session has its own pointer and keyboard. `domicile pointer`, `drag`, `scroll`, `key`, `type` and `focus-window` take `--agent <session>`, and `domicile agent` prints its session. The MCP server's pointer and key tools use it, so only `send_shell` waits for the user to step away.
