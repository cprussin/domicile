---
"@domicile-desktop/sdk": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/app-settings": patch
"domicile": minor
---

`idle.ignore_pointer_motion` blanks and locks whether or not the pointer moves: its motion holds off neither timeout and lights no dark screen. Keys, touches, clicks and scrolling still do. For a mouse that reports motion by itself. The engine says whether each input was a key, a touch, pointer motion or another use of the pointer, and reports the rest however much the pointer moves.
