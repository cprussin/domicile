---
"@domicile-desktop/engine": patch
---

A browser window's page no longer reads `hidden` for a moment when its window is shown or attached, so pages that refetch or animate on `visibilitychange` stay still.
