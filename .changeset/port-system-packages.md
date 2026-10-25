---
"@domicile-desktop/system-battery": minor
"@domicile-desktop/system-bluetooth": minor
"@domicile-desktop/system-backlight": minor
"@domicile-desktop/system-audio": minor
"@domicile-desktop/system-network": minor
"@domicile-desktop/manganese-bar-module-battery": patch
"@domicile-desktop/manganese-bar-module-bluetooth": patch
"@domicile-desktop/manganese-bar-module-brightness": patch
"@domicile-desktop/manganese-bar-module-volume": patch
"@domicile-desktop/manganese-bar-module-network": patch
---

The `system-*` libraries take `desktop(domicile)` instead of `system(domicile)`, and call its `files`, `processes` and `dbus` namespaces. Their host types are renamed to match: `NetworkSystem` is `NetworkDesktop`, `WifiSystem` is `WifiDesktop`, `InterfaceSystem` is `InterfaceDesktop`, `AudioSystem` is `AudioDesktop` and `SysfsSystem` is `SysfsDesktop`.
