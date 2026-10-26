---
"@domicile-desktop/manganese": patch
---

The user guide's `shell_options` examples nest groups, as the config reads them: `{ "clock": { "format": "12h" } }`, not `"clock.format"`.
