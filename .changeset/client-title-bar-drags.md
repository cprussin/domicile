---
"@domicile-desktop/sdk": minor
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese": minor
---

Dragging the title bar or edge an app draws itself, such as a GNOME app's header bar or Firefox's tab strip, moves or resizes its window. The compositor checks the press is still held, takes it from the app, and reports `WindowRequest.Move` or `WindowRequest.Resize` (with a `ResizeEdge`); Manganese runs the drag as it does a Meta drag.
