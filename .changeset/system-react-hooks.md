---
"@domicile-desktop/react": minor
"@domicile-desktop/system-battery": minor
"@domicile-desktop/system-bluetooth": minor
"@domicile-desktop/system-network": minor
"@domicile-desktop/system-audio": minor
"@domicile-desktop/manganese-host": major
"@domicile-desktop/manganese-bar-module-battery": patch
"@domicile-desktop/manganese-bar-module-bluetooth": patch
"@domicile-desktop/manganese-bar-module-network": patch
"@domicile-desktop/manganese-bar-module-volume": major
"@domicile-desktop/manganese-bar-module-brightness": patch
"@domicile-desktop/manganese-bar-module-cast": patch
"@domicile-desktop/manganese-bar-module-gmail": patch
"@domicile-desktop/manganese-bar-module-google-messages": patch
"@domicile-desktop/manganese-bar-module-idle-inhibitor": patch
"@domicile-desktop/manganese-bar-module-keymap": patch
"@domicile-desktop/manganese-bar-module-sharing": patch
"@domicile-desktop/manganese-bar-module-tray": patch
"@domicile-desktop/manganese": patch
---

React hooks for system state. Each `system-*` package has a `/react` with hooks and one watch per desktop: `useBattery`, `useBluetooth`, `useNetwork`, `useWifi`, `useAudio` and more. `@domicile-desktop/react` gains the shared watches (`sharedWatch`, `perDesktop`, `useSharedWatch`, `useDeskWatch`, `watchPresence`). manganese-host's `domicile-context`, `per-host`, `shared-watch`, `useSharedWatch` and `watch-presence` move there, and manganese uses `<DomicileProvider>`.
