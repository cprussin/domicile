---
"domicile": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese": minor
"@domicile-desktop/e2e-harness": patch
---

A shell command that acts on a window takes `--window <id>` after its first word (`domicile send-shell move --window <id> right`) and runs on that window, not the user's focus, and an agent's `send_shell` takes one for a window its seat holds, so an agent can move its own window to another workspace. A shell marks such commands `window: true` in `bindKeys`' `commands`, and `onCommand` gets the window as its second argument.
