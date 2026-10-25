---
"@domicile-desktop/sdk": minor
---

`desktop(domicile)` (`@domicile-desktop/sdk/desktop/desktop`) builds the desktop as one typed object, a namespace per subject: `windows`, `browser`, `displays`, `keyboard`, `pointer`, `theme`, `appearance`, `session`, `clipboard`, `tray`, `notifications`, `extensions`, `portals`, `files`, `processes`, `dbus`, `capture` and `shell`. Values are `undefined` rather than `null`, and each namespace's events come through `on`, which returns its unsubscribe. `appDesktop(host)` does the same for an app module.
