---
"@domicile-desktop/app-settings": minor
"@domicile-desktop/e2e-harness": patch
"domicile": minor
---

Settings changes a config it cannot write until the desktop restarts or the file changes that setting, marking each change with Reset. The compositor holds the changes: `set_config_override`, `reset_config_overrides` and `config_overrides` on the control socket.
