---
"@domicile-desktop/component-library": patch
"@domicile-desktop/manganese-bar-module-battery": minor
"@domicile-desktop/manganese-quick-settings": patch
---

Center the quick settings button's icons. The Wi-Fi icon dims its unlit arcs instead of hiding them, so it keeps its shape at any signal. The battery in the button drops its own inset and the room it kept for `100%` (new `fitted` prop, `BatteryIndicator` export), so both ends of the button match.
