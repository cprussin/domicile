---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"domicile": minor
---

Shells can follow the pointer: `domicile.pointer.follow(onMove)` calls `onMove` with the pointer's place, at most once per frame, until the function it returns runs. The engine sends nothing while no one follows, and only the shell can follow.
