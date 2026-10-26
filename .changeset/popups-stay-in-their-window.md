---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-window-management": patch
"@domicile-desktop/test-support": patch
---

Popups stay inside their window. `PopupBoundary` keeps every tooltip, popover, menu and list inside it within its box; `Popover` and `Tooltip` take `spansWindows` to leave it. Each window and tab keeps its popups inside its frame, so a tab's tooltip no longer covers the windows beside it. `test-support/popup-layout` fakes the layout a popup is placed by.
