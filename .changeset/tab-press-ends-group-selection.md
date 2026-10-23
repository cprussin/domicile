---
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese": patch
---

Pressing a title bar or tab inside a selected group selects just that window. A title bar's float and fullscreen buttons act on their own window, never the selected group, and a tab of a floating group tiles alone. `Stage` takes `onBarPress`, and `WindowAction.WindowBarPressed` is new.
