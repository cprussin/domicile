---
"@domicile-desktop/sdk": minor
"@domicile-desktop/system-bluetooth": patch
"@domicile-desktop/system-network": patch
---

`@domicile-desktop/sdk/desktop/dbus-properties`: `allProperties` reads a D-Bus object's properties with `Properties.GetAll` and parses them, and `variant` reads a `v` as its value. The network and Bluetooth packages use them in place of their own copies.
