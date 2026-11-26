---
"@domicile-desktop/engine": patch
"domicile": patch
---

A shader effect's arrays reach it while its filter animates on the compositor. The engine kept each `update` made during such an animation from the compositor until something else changed, so the example shell's cloth close effect only faded.
