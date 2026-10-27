---
"@domicile-desktop/manganese": minor
"@domicile-desktop/component-library": minor
"@domicile-desktop/system-battery": minor
"@domicile-desktop/manganese-bar-module-battery": minor
"@domicile-desktop/manganese-bar-module-bluetooth": minor
"@domicile-desktop/manganese-bar-module-brightness": minor
"@domicile-desktop/manganese-bar-module-idle-inhibitor": minor
"@domicile-desktop/manganese-bar-module-network": minor
"@domicile-desktop/manganese-bar-module-theme-switch": minor
"@domicile-desktop/manganese-bar-module-volume": minor
---

Quick settings: one bar item (`@domicile-desktop/manganese/QuickSettings`) replaces the theme, keep awake, brightness, volume, Bluetooth, network and battery items in `DEFAULT_BAR` and `LOCK_BAR`. Its button shows the network, sound and battery, plus the eye while the screens are kept on and Bluetooth while a device is connected. Its panel has labeled tiles (Wi-Fi or Wired, Bluetooth, Keep awake, Night light, Dark mode), the brightness and volume sliders, and the battery in words with the time left, and a Settings button. A tile's arrow opens the item's panel in place. Each hardware item exports its parts as `./quick-settings`; the component library adds `QuickTile`, and `system-battery` reads UPower's `TimeToEmpty` as `secondsLeft`.
