---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-notifications": patch
---

Pausing notifications moves nothing in the drawer: its header keeps the "Paused until …" line's room while not paused.

- `PanelHeader` takes `reserveStatus`, which keeps the status's line while there is none.
