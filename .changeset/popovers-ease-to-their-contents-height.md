---
"@domicile-desktop/component-library": patch
"@domicile-desktop/sdk": patch
---

- `Popover`, `ModalDialog` and `Autocomplete` lists ease to their content's height instead of jumping.
- A `LeavingRow` grows from no height as it arrives, moving the rows below smoothly, and sliding in or out no longer scrolls its list sideways.
- `FakeDomicileHost` clears downloads not in progress on `clearDownloads()`, as the engine does.
