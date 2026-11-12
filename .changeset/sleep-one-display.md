---
"domicile": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/engine": minor
---

Name a monitor to turn only that one off, like `domicile sleep-displays DP-1`. It keeps its windows and workspace, and stays off while you use the others until `domicile wake-displays DP-1`. Shells pass the name to `displays.sleep()` and `displays.wake()`.
