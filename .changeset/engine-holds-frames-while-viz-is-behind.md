---
"domicile": patch
---

A window drawing faster than the engine can show it no longer crashes the engine's GPU process: while viz is 16 frames behind, the engine holds the window's newest frame and drops the ones it replaces.
