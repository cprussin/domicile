---
"@domicile-desktop/engine": patch
"domicile": patch
---

A shader effect's arrays reach it while its filter animates on the compositor. The engine dropped each `update` made during such an animation, so the example shell's cloth close effect only faded.
