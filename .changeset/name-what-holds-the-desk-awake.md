---
"domicile": patch
"@domicile-desktop/engine": patch
"@domicile-desktop/sdk": minor
"@domicile-desktop/manganese-bar-module-idle-inhibitor": minor
---

Name what keeps the screens on. A new `idle_holds` system call (`session.idleHolds()` in the SDK) lists the windows and applications holding idle inhibitors, and the bar's eye opens and names them. The compositor logs each change, and the input that restarts the idle clock when it was getting close to blanking or locking, naming the event and device for the browser's own input.
