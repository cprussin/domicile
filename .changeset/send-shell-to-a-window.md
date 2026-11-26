---
"domicile": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese": minor
"@domicile-desktop/e2e-harness": patch
---

`domicile send-shell --window <id>` runs a command on a window, not the user's focus, and an agent's `send_shell` takes a window its seat holds, so an agent can move its own window to another workspace. `bindKeys` takes `onWindowCommand`.
