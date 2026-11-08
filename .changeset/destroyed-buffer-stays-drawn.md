---
"domicile": patch
"@domicile-desktop/engine": patch
---

App windows no longer flash white while they resize. An app may throw away a frame the screen is still showing, such as one drawn at its old size. The engine now keeps that frame until the screen is done with it, instead of drawing a blank in its place.
