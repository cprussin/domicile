---
"@domicile-desktop/sdk": minor
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-host": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese-bar-module-battery": patch
"@domicile-desktop/manganese-bar-module-bluetooth": patch
"@domicile-desktop/manganese-bar-module-brightness": patch
"@domicile-desktop/manganese-bar-module-gmail": patch
"@domicile-desktop/manganese-bar-module-google-messages": patch
"@domicile-desktop/manganese-bar-module-idle-inhibitor": patch
"@domicile-desktop/manganese-bar-module-network": patch
"@domicile-desktop/manganese-bar-module-sharing": patch
"@domicile-desktop/manganese-bar-module-tray": patch
"@domicile-desktop/manganese-bar-module-volume": patch
"@domicile-desktop/manganese-bar-module-keymap": patch
"@domicile-desktop/manganese-clipboard": patch
"@domicile-desktop/manganese-lock": patch
"@domicile-desktop/manganese-notifications": patch
"@domicile-desktop/manganese": patch
"@domicile-desktop/shell-simple": patch
"@domicile-desktop/shell-splash": patch
---

Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
