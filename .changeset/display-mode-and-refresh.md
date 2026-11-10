---
"@domicile-desktop/sdk": minor
"domicile": minor
"@domicile-desktop/engine": minor
---

A display profile can set a monitor's mode and refresh rate. `mode: [W, H]` now lights the monitor at that size, refusing the profile when the monitor does not offer it, and the new `refresh` (in Hz) picks the nearest rate the monitor offers. The SDK's `Display` gains `refreshMhz`, the rate the monitor scans out at.
