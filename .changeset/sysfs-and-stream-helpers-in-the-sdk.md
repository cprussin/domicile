---
"@domicile-desktop/sdk": minor
"@domicile-desktop/system-audio": major
"@domicile-desktop/system-battery": major
"@domicile-desktop/system-bluetooth": major
"@domicile-desktop/manganese-bar-module-idle-inhibitor": patch
"@domicile-desktop/manganese-bar-module-keymap": patch
"@domicile-desktop/manganese-lock": patch
"@domicile-desktop/manganese-notifications": patch
"@domicile-desktop/manganese-window-management": patch
---

The SDK has `@domicile-desktop/sdk/sysfs` (`SysfsDesktop`, `sysfsEntries`, `sysfsLine`, `anyOf`) for reading `/sys`, and `@domicile-desktop/sdk/streams` (`eachOf`) for following a stream to its end. `system-audio`, `system-battery` and `system-bluetooth` no longer export their own `SysfsDesktop` from `./hardware`; take it from `@domicile-desktop/sdk/sysfs`.
