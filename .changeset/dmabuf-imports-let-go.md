---
"domicile": patch
---

Fix memory filling up until the desktop crashes when every app draws with the GPU. The compositor now lets go of a window's old graphics buffers once the app frees them.
