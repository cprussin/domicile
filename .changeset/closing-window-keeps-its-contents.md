---
"domicile": patch
"@domicile-desktop/engine": patch
---

A closing window animates out with its contents again, instead of its picture vanishing at once. The compositor keeps a closed app window's surface, and the engine a closed browser window's page (muted), for a second while the shell animates it out.
