---
"@domicile-desktop/sdk": minor
"@domicile-desktop/system-battery": patch
"@domicile-desktop/system-bluetooth": patch
"@domicile-desktop/system-network": patch
---

A watch's and a D-Bus match's `items` are `Listened<T>`: `Listened.Heard(item)`, or `Listened.Missed()` after a compositor restart, when changes in between were not heard. The battery, Bluetooth, network, tray menu and icon theme readers read again then.
