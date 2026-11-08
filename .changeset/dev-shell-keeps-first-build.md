---
"@domicile-desktop/dev-shell": patch
---

`dev-shell.sh` no longer exits at startup with "no shell at …/shell.js": the watcher keeps the existing build while it rebuilds.
