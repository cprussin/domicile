---
"@domicile-desktop/system-audio": minor
"@domicile-desktop/system-battery": minor
"@domicile-desktop/system-bluetooth": minor
"@domicile-desktop/manganese-host": minor
"@domicile-desktop/manganese-bar-module-battery": minor
"@domicile-desktop/manganese-bar-module-bluetooth": minor
"@domicile-desktop/manganese-bar-module-brightness": minor
"@domicile-desktop/manganese-bar-module-volume": minor
---

The battery, Bluetooth, brightness and volume items hide only on a machine without that hardware. With the hardware and no service to read it, each shows a dimmed icon saying so. The system libraries add `hardware`, which looks in `/sys`, and `manganese-host` adds `watch-presence`.
