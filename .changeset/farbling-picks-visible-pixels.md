---
"@domicile-desktop/engine": patch
"domicile": patch
---

Fingerprinting protection now always changes a canvas a page reads back, however little of it is drawn. Before, it picked pixels from the whole canvas and skipped clear ones, so a mostly clear canvas came back unchanged for about one site in thirty.
