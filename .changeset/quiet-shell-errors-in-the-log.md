---
"@domicile-desktop/sdk": patch
"@domicile-desktop/component-library": patch
"@domicile-desktop/electron-host": patch
"@domicile-desktop/manganese-bar-module-network": patch
"@domicile-desktop/popover-harness": patch
"domicile": patch
---

The desktop's error log no longer fills with a shell's ResizeObserver loops and `[object Object]`, and Electron apps follow logind on the system bus. `easeHeight` starts easing as a popup's content changes, before layout, rather than resizing it while a ResizeObserver answers; the SDK's `logger` writes objects as JSON and errors as their stacks; electron-host waits on the bus with `GetId`, which the system bus's policy allows, not `Peer.Ping`.
