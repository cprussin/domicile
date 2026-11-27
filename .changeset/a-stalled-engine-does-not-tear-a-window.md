---
"domicile": patch
---

A window that draws in shared memory no longer tears, or shows its popups a frame apart from its content, after the engine stalls for half a second. The compositor no longer takes back its copy of a window's frame while the engine may still be drawing it.
