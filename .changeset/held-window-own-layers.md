---
"@domicile-desktop/manganese-window-management": patch
---

Dragging or resizing a window repaints far less: each part of a held window gets its own layer, and the scratchpad's `--lift` is set only while it slides, not on every pointer move.
