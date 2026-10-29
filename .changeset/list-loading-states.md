---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-bar-module-bluetooth": patch
"@domicile-desktop/manganese-bar-module-network": patch
---

Wi-Fi and Bluetooth lists hold their height while they load or are empty. Searching shows what it looks for with rings spreading out from it, "No networks nearby" offers a "Look again" button, and the Scan button turns while it scans. `Loading` gains an `icon` and drops its `row` layout, `EmptyState` gains an `action`, and `IconButton` a `busy` prop.
