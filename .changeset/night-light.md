---
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/system-backlight": minor
"@domicile-desktop/manganese-bar-module-brightness": minor
"@domicile-desktop/manganese": minor
"@domicile-desktop/app-settings": patch
---

Automatic brightness and a night light, as on macOS. The backlight follows the room's light from iio-sensor-proxy and learns from the levels the user sets. The night light warms every monitor from sunset to sunrise in the time zone's city, or on custom hours, with a switch in the brightness popover. Both are on by default and set in the Settings app's Shell page or under `shell_options`. Shells set the color temperature with `system(domicile).setColorTemperature(kelvin)`.
