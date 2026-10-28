---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-bar-module-bluetooth": patch
"@domicile-desktop/manganese-bar-module-brightness": patch
"@domicile-desktop/manganese-bar-module-network": patch
"@domicile-desktop/manganese-bar-module-volume": patch
"@domicile-desktop/manganese-notifications": patch
"@domicile-desktop/manganese-quick-settings": patch
---

Quick settings, its Wi-Fi, Bluetooth and Sound details, and the notifications panel are built from shared panel parts (`Panel`, `PanelHeader`, `PanelSection`, `ListRow`, `DetailList`, `SliderRow`, `PanelNote`, `PanelFooter`, `IconButton`) with one type scale and set of colors, so they line up and nothing spills out of its panel. Bluetooth devices are grouped as connected, paired and nearby; refusals say what failed in plain words; and a panel opened with the pointer no longer shows a focus ring on its first control.
