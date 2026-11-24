---
"domicile": patch
---

The compositor finds the engine library's IO thread to raise its priority even while other threads are ending. Listing `/proc/self/task` could skip a running thread when another one ended during the listing, so the lookup now lists again until two listings agree.
